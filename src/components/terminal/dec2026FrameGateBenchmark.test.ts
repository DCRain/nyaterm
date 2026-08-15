import { describe, expect, it } from "vitest";
import { XTERM_PERFORMANCE_CONFIG } from "@/lib/xtermPerformance";
import {
  Dec2026FrameGate,
  type Dec2026FrameGateMode,
} from "./dec2026FrameGate";
import type { QueuedOutputChunk } from "./xterminalOutputQueue";

const encoder = new TextEncoder();
const begin = "\x1b[?2026h";
const end = "\x1b[?2026l";
const resetClearHome = "\x1b[0m\x1b[2J\x1b[1;1H";

interface BenchmarkMetrics {
  maxOutputDrainQueueBytes: number;
  maxFrameGateHeldBytes: number;
  maxTotalFrontendPendingBytes: number;
  framesReceived: number;
  framesRendered: number;
  framesCollapsed: number;
  bytesCollapsed: number;
  xtermWriteCount: number;
  maxWriteCallbackLatencyMs: number;
  longestForegroundStallMs: number;
  severeFallbackTicks: number;
  newestFrameWriteLagMs: number;
}

function bytes(text: string) {
  return encoder.encode(text).length;
}

function makeFrame(index: number, safe: boolean) {
  const body = `${String(index).padStart(4, "0")} ${"abcdef0123456789".repeat(128)}`;
  if (safe) return `${begin}${resetClearHome}${body}${end}`;
  if (index % 4 === 0) return `${begin}\x1b]0;title-${index}\x07${body}${end}`;
  if (index % 4 === 1) return `${begin}\x1b[?25l${body}${end}`;
  if (index % 4 === 2) return `${begin}\x1b[999z${body}${end}`;
  return `${begin}${body}${end}`;
}

function makeCorpus(safe: boolean, frameCount = 180) {
  return Array.from({ length: frameCount }, (_, index) => makeFrame(index, safe));
}

function runSynthetic(mode: Dec2026FrameGateMode, corpus: string[]): BenchmarkMetrics {
  let now = 0;
  let outputDrainQueueBytes = XTERM_PERFORMANCE_CONFIG.output.alternateScreenThrottleBacklogBytes + 1;
  let maxOutputDrainQueueBytes = outputDrainQueueBytes;
  let maxFrameGateHeldBytes = 0;
  let maxTotalFrontendPendingBytes = outputDrainQueueBytes;
  let xtermWriteCount = 0;
  let framesRendered = 0;
  let maxWriteCallbackLatencyMs = 0;
  let longestForegroundStallMs = 0;
  let severeFallbackTicks = 0;
  let newestFrameWriteLagMs = 0;
  const frameArrivalTimes = new Map<number, number>();

  const writes: QueuedOutputChunk[] = [];
  const acks: number[] = [];
  let gate!: Dec2026FrameGate;
  gate = new Dec2026FrameGate({
    mode,
    forward: (chunk) => {
      writes.push(chunk);
      outputDrainQueueBytes += chunk.bytes;
      maxOutputDrainQueueBytes = Math.max(maxOutputDrainQueueBytes, outputDrainQueueBytes);
      const writeLatency = Math.min(24, Math.ceil(chunk.bytes / 4096));
      now += writeLatency;
      xtermWriteCount += 1;
      maxWriteCallbackLatencyMs = Math.max(maxWriteCallbackLatencyMs, writeLatency);
      longestForegroundStallMs = Math.max(longestForegroundStallMs, writeLatency);
      if (
        outputDrainQueueBytes >
        XTERM_PERFORMANCE_CONFIG.output.alternateScreenThrottleBacklogBytes
      ) {
        severeFallbackTicks += 1;
      }
      outputDrainQueueBytes = Math.max(0, outputDrainQueueBytes - chunk.bytes);
      framesRendered += (chunk.data.match(/\x1b\[\?2026l/g) ?? []).length;
      const match = /(\d{4})/u.exec(chunk.data);
      if (match) {
        const index = Number(match[1]);
        newestFrameWriteLagMs = Math.max(
          newestFrameWriteLagMs,
          now - (frameArrivalTimes.get(index) ?? now),
        );
      }
    },
    ackDropped: (count) => acks.push(count),
    getPressureSnapshot: () => ({
      alternateScreen: true,
      outputDrainQueueBytes,
      outputDrainPendingBytes: outputDrainQueueBytes,
      frameGateHeldBytes: gate.getHeldBytes(),
      performanceMode: "strained",
    }),
    onPressureChange: () => {
      maxFrameGateHeldBytes = Math.max(maxFrameGateHeldBytes, gate.getHeldBytes());
      maxTotalFrontendPendingBytes = Math.max(
        maxTotalFrontendPendingBytes,
        outputDrainQueueBytes + gate.getHeldBytes(),
      );
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
  });

  corpus.forEach((data, index) => {
    frameArrivalTimes.set(index, now);
    gate.enqueue({ data, bytes: bytes(data) });
    now += 1000 / 60;
  });
  gate.flush("benchmark-end");

  const snapshot = gate.snapshot();
  return {
    maxOutputDrainQueueBytes,
    maxFrameGateHeldBytes,
    maxTotalFrontendPendingBytes,
    framesReceived: corpus.length,
    framesRendered,
    framesCollapsed: snapshot.droppedFrames,
    bytesCollapsed: acks.reduce((sum, count) => sum + count, 0),
    xtermWriteCount,
    maxWriteCallbackLatencyMs,
    longestForegroundStallMs,
    severeFallbackTicks,
    newestFrameWriteLagMs,
  };
}

describe("DEC 2026 synthetic frame gate benchmark", () => {
  it("collapses only the safe self-contained corpus under pressure", () => {
    const safeCorpus = makeCorpus(true);
    const unsafeCorpus = makeCorpus(false);
    const baselineSafe = runSynthetic("off", safeCorpus);
    const shadowSafe = runSynthetic("shadow", safeCorpus);
    const collapseSafe = runSynthetic("collapse", safeCorpus);
    const collapseUnsafe = runSynthetic("collapse", unsafeCorpus);

    expect(shadowSafe.framesCollapsed).toBe(0);
    expect(shadowSafe.framesRendered).toBe(baselineSafe.framesRendered);
    expect(collapseSafe.framesCollapsed).toBeGreaterThan(0);
    expect(collapseSafe.bytesCollapsed).toBeGreaterThan(0);
    expect(collapseSafe.xtermWriteCount).toBeLessThan(baselineSafe.xtermWriteCount);
    expect(collapseUnsafe.framesCollapsed).toBe(0);
    expect(collapseUnsafe.framesRendered).toBe(unsafeCorpus.length);
    expect(collapseSafe.maxFrameGateHeldBytes).toBeLessThan(512 * 1024);
  });
});
