import { describe, expect, it } from "vitest";
import { XTERM_PERFORMANCE_CONFIG } from "@/lib/xtermPerformance";
import {
  classifyDec2026Frame,
  Dec2026FrameGate,
  type Dec2026FrameGateMode,
} from "./dec2026FrameGate";
import type { QueuedOutputChunk } from "./xterminalOutputQueue";

const encoder = new TextEncoder();
const begin = "\x1b[?2026h";
const end = "\x1b[?2026l";
const c1Begin = "\x9b?2026h";
const c1End = "\x9b?2026l";
const resetClearHome = "\x1b[0m\x1b[2J\x1b[1;1H";

function bytes(text: string) {
  return encoder.encode(text).length;
}

function successorProof(content: string) {
  const classification = classifyDec2026Frame(content);
  return classification.kind === "replaceable-visual"
    ? classification.successorProof
    : null;
}

function frame(content: string) {
  return `${begin}${content}${end}`;
}

function createHarness(
  options: {
    mode?: Dec2026FrameGateMode;
    alternateScreen?: boolean;
    queueBytes?: number;
    pendingBytes?: number;
    performanceMode?: string;
  } = {},
) {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const forwarded: QueuedOutputChunk[] = [];
  const acks: number[] = [];
  let gate!: Dec2026FrameGate;
  gate = new Dec2026FrameGate({
    mode: options.mode ?? "collapse",
    forward: (chunk) => forwarded.push(chunk),
    ackDropped: (count) => acks.push(count),
    getPressureSnapshot: () => ({
      alternateScreen: options.alternateScreen ?? true,
      outputDrainQueueBytes:
        options.queueBytes ??
        XTERM_PERFORMANCE_CONFIG.output.alternateScreenThrottleBacklogBytes + 1,
      outputDrainPendingBytes: options.pendingBytes ?? 0,
      frameGateHeldBytes: gate.getHeldBytes(),
      performanceMode: options.performanceMode ?? "strained",
    }),
    setTimeout: (callback, delay) => {
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
  });

  const enqueue = (data: string, ingressBytes = bytes(data)) => {
    gate.enqueue({ data, bytes: ingressBytes });
  };

  const advance = (ms: number) => {
    now += ms;
    const due = [...timers.entries()]
      .filter(([, timer]) => timer.at <= now)
      .sort((left, right) => left[1].at - right[1].at);
    for (const [id, timer] of due) {
      timers.delete(id);
      timer.callback();
    }
  };

  return {
    acks,
    advance,
    enqueue,
    forwarded,
    gate,
    joined: () => forwarded.map((chunk) => chunk.data).join(""),
    forwardedBytes: () => forwarded.reduce((total, chunk) => total + chunk.bytes, 0),
  };
}

describe("Dec2026FrameGate detector", () => {
  it("detects complete, split, repeated, and C1 DEC 2026 frames in shadow mode", () => {
    const { enqueue, forwarded, gate, joined } = createHarness({ mode: "shadow" });
    const payload = `${frame("one")}${frame("two")}`;

    enqueue(payload);
    enqueue(`${begin}thr`);
    enqueue(`ee${end}`);
    enqueue(`${c1Begin}four${c1End}`);

    expect(joined()).toBe(`${payload}${frame("three")}${c1Begin}four${c1End}`);
    expect(forwarded.every((chunk) => chunk.bytes === bytes(chunk.data))).toBe(true);
    expect(gate.snapshot().completeFrames).toBe(4);
    expect(gate.snapshot().framesSeen).toBe(4);
  });

  it("fails open for close without open, nested open, and malformed partial state", () => {
    const { advance, enqueue, gate, joined } = createHarness();

    enqueue(`${end}plain`);
    enqueue(`${begin}first${begin}nested`);
    advance(200);

    expect(joined()).toContain(`${end}plain`);
    expect(joined()).toContain(`${begin}first${begin}nested`);
    expect(gate.snapshot().failOpenCandidates).toBeGreaterThanOrEqual(2);
  });
});

describe("Dec2026FrameGate classification", () => {
  it("accepts pure visual printable, SGR, cursor movement, erase, and safe C0", () => {
    expect(classifyDec2026Frame("hello中文é😀\r\t\b\x1b[31m\x1b[2K\x1b[10;20H").kind).toBe(
      "replaceable-visual",
    );
  });

  it("rejects stateful and unknown sequences conservatively", () => {
    expect(classifyDec2026Frame("\x07").kind).toBe("stateful");
    expect(classifyDec2026Frame("\x1b]0;title\x07").kind).toBe("stateful");
    expect(classifyDec2026Frame("\x1bPpayload\x1b\\").kind).toBe("stateful");
    expect(classifyDec2026Frame("\x1b[?25l").kind).toBe("stateful");
    expect(classifyDec2026Frame("\x1b[?1049h").kind).toBe("stateful");
    expect(classifyDec2026Frame("\x1b[3J").kind).toBe("stateful");
    expect(classifyDec2026Frame("\x1b[S").kind).toBe("stateful");
    expect(classifyDec2026Frame("\x1b[999z").kind).toBe("unknown");
  });

  it("requires reset, ED2 after reset, and home before printable for replacement proof", () => {
    expect(successorProof(`${resetClearHome}new`)).toBe("self-contained-replacement");
    expect(successorProof("\x1b[2J\x1b[1;1Hnew")).toBe("none");
    expect(successorProof("\x1b[0m\x1b[1;1Hnew")).toBe("none");
    expect(successorProof("\x1b[0m\x1b[2Jnew")).toBe("none");
    expect(successorProof(`new${resetClearHome}`)).toBe("none");
  });
});

describe("Dec2026FrameGate collapse behavior", () => {
  it("forwards everything immediately below pressure threshold", () => {
    const { acks, enqueue, gate, joined } = createHarness({
      queueBytes: XTERM_PERFORMANCE_CONFIG.output.alternateScreenThrottleBacklogBytes,
    });

    enqueue(frame("A"));
    enqueue(frame(`${resetClearHome}B`));

    expect(joined()).toBe(`${frame("A")}${frame(`${resetClearHome}B`)}`);
    expect(acks).toEqual([]);
    expect(gate.snapshot().droppedFrames).toBe(0);
  });

  it("drops a pure visual predecessor when the successor is self-contained under pressure", () => {
    const a = frame("old visual");
    const b = frame(`${resetClearHome}new visual`);
    const { acks, enqueue, gate, joined } = createHarness();

    enqueue(a);
    expect(gate.getHeldBytes()).toBe(bytes(a));
    expect(joined()).toBe("");

    enqueue(b);
    expect(acks).toEqual([bytes(a)]);
    expect(gate.snapshot().droppedFrames).toBe(1);

    gate.flush("test");
    expect(joined()).toBe(b);
  });

  it("does not collapse across a barrier", () => {
    const a = frame("old visual");
    const barrier = "\x1b]0;title\x07";
    const b = frame(`${resetClearHome}new visual`);
    const { acks, enqueue, gate, joined } = createHarness();

    enqueue(a);
    enqueue(barrier);
    enqueue(b);
    gate.flush("test");

    expect(acks).toEqual([]);
    expect(joined()).toBe(`${a}${barrier}${b}`);
  });

  it("keeps exact UTF-8 accounting for Unicode collapsed frames", () => {
    const samples = ["ASCII", "中文", "é", "e\u0301", "😀", "👨‍👩‍👧‍👦", "\x1b[31m中文😀"];

    for (const sample of samples) {
      const a = frame(sample);
      const b = frame(`${resetClearHome}${sample}`);
      const { acks, enqueue, forwardedBytes, gate } = createHarness();

      enqueue(a);
      expect(forwardedBytes() + acks.reduce((sum, count) => sum + count, 0) + gate.getHeldBytes()).toBe(
        bytes(a),
      );
      enqueue(b);
      gate.flush("unicode-test");

      expect(forwardedBytes() + acks.reduce((sum, count) => sum + count, 0)).toBe(
        bytes(a) + bytes(b),
      );
    }
  });

  it("fails open on timeout and max held bytes", () => {
    const timeoutHarness = createHarness();
    timeoutHarness.enqueue(`${begin}unterminated`);
    timeoutHarness.advance(200);
    expect(timeoutHarness.joined()).toBe(`${begin}unterminated`);

    const capHarness = createHarness();
    const large = `${begin}${"x".repeat(512 * 1024)}`;
    capHarness.enqueue(large);
    expect(capHarness.joined()).toBe(large);
  });

  it("fails open instead of guessing when ingress byte accounting mismatches", () => {
    const a = frame("中文");
    const { acks, enqueue, gate, joined } = createHarness();

    enqueue(a, a.length);

    expect(joined()).toBe(a);
    expect(acks).toEqual([]);
    expect(gate.snapshot().failOpenCandidates).toBe(1);
  });

  it("flushes held output before lifecycle text", () => {
    const a = frame("held");
    const lifecycle = "\r\n[session closed]\r\n";
    const { enqueue, forwarded, gate, joined } = createHarness();

    enqueue(a);
    gate.flush("session-close");
    forwarded.push({ data: lifecycle, bytes: bytes(lifecycle) });

    expect(joined()).toBe(`${a}${lifecycle}`);
  });
});
