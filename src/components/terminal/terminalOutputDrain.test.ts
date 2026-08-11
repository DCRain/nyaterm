import { describe, expect, it, vi } from "vitest";
import { XTERM_PERFORMANCE_CONFIG } from "@/lib/xtermPerformance";
import { TerminalOutputDrain } from "./terminalOutputDrain";

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function createHarness(options: { writeChunkBytes?: number; autoCompleteWrites?: boolean } = {}) {
  let now = 0;
  let nextTimerId = 1;
  let nextFrameId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const frames = new Map<number, FrameRequestCallback>();
  const pendingWriteCallbacks: Array<() => void> = [];
  const writes: string[] = [];
  const acks: number[] = [];
  const pressure: number[] = [];

  const terminal = {
    write: vi.fn((data: string, callback?: () => void) => {
      writes.push(data);
      if (!callback) return;
      if (options.autoCompleteWrites === false) {
        pendingWriteCallbacks.push(callback);
      } else {
        callback();
      }
    }),
  };

  const drain = new TerminalOutputDrain({
    sessionId: "session-1",
    getTerminal: () => terminal,
    getWriteChunkBytes: () => options.writeChunkBytes ?? 1024,
    onAck: (bytes) => acks.push(bytes),
    onPressureChange: (bytes) => pressure.push(bytes),
    timers: {
      requestAnimationFrame: (callback) => {
        const id = nextFrameId;
        nextFrameId += 1;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame: (id) => {
        frames.delete(id);
      },
      setTimeout: (callback, delay) => {
        const id = nextTimerId;
        nextTimerId += 1;
        timers.set(id, { at: now + delay, callback });
        return id;
      },
      clearTimeout: (id) => {
        timers.delete(id);
      },
      queueMicrotask: (callback) => callback(),
      now: () => now,
    },
  });

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

  const flushFrame = () => {
    const due = [...frames.values()];
    frames.clear();
    for (const callback of due) {
      callback(now);
    }
  };

  return {
    acks,
    advance,
    drain,
    flushFrame,
    pendingWriteCallbacks,
    pressure,
    terminal,
    timers,
    writes,
  };
}

describe("TerminalOutputDrain", () => {
  it("drains hidden output in original order", async () => {
    const { advance, drain, writes } = createHarness();

    drain.setMode("background");
    drain.enqueue({ data: "A", bytes: 1 });
    drain.enqueue({ data: "B", bytes: 1 });
    drain.enqueue({ data: "C", bytes: 1 });

    advance(XTERM_PERFORMANCE_CONFIG.output.backgroundDrainIntervalMs);
    await settle();

    expect(writes.join("")).toBe("ABC");
  });

  it("consumes hidden output periodically instead of waiting for reveal", async () => {
    const { advance, drain, writes } = createHarness({ writeChunkBytes: 1 });

    drain.setMode("background");
    drain.enqueue({ data: "A", bytes: 1 });
    advance(XTERM_PERFORMANCE_CONFIG.output.backgroundDrainIntervalMs);
    await settle();
    drain.enqueue({ data: "B", bytes: 1 });
    advance(XTERM_PERFORMANCE_CONFIG.output.backgroundDrainIntervalMs);
    await settle();

    expect(writes).toEqual(["A", "B"]);
  });

  it("chunks large foreground output cooperatively", async () => {
    const { drain, flushFrame, writes } = createHarness({ writeChunkBytes: 4 });

    drain.setMode("foreground");
    drain.enqueue({ data: "abcdefghij", bytes: 10 });
    flushFrame();
    await settle();

    expect(writes).toEqual(["abcd"]);
    await settle();
    flushFrame();
    await settle();
    expect(writes).toEqual(["abcd", "efgh"]);
    await settle();
    flushFrame();
    await settle();
    expect(writes).toEqual(["abcd", "efgh", "ij"]);
  });

  it("acks only bytes completed by write callbacks", async () => {
    const { acks, drain, flushFrame, pendingWriteCallbacks } = createHarness({
      autoCompleteWrites: false,
      writeChunkBytes: 4,
    });

    drain.setMode("foreground");
    drain.enqueue({ data: "abcd", bytes: 4 });
    flushFrame();
    await settle();

    expect(acks).toEqual([]);
    pendingWriteCallbacks.shift()?.();
    await settle();
    expect(acks).toEqual([4]);
  });

  it("waitForIdle drains all data without dropping queued bytes", async () => {
    const { drain, writes } = createHarness({ writeChunkBytes: 2 });

    drain.setMode("hibernating");
    drain.enqueue({ data: "\x1b[?25lxx\x1b[?25h", bytes: 14 });

    await expect(drain.waitForIdle(100)).resolves.toBe(true);
    expect(writes.join("")).toBe("\x1b[?25lxx\x1b[?25h");
  });
});
