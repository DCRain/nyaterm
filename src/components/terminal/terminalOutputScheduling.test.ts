import { describe, expect, it } from "vitest";
import { XTERM_PERFORMANCE_CONFIG } from "@/lib/xtermPerformance";
import { TerminalOutputScheduler } from "./terminalOutputScheduling";

describe("TerminalOutputScheduler", () => {
  it("uses normal write chunks outside alternate screen", () => {
    const scheduler = new TerminalOutputScheduler({
      getQueueBytes: () => 1024,
      isAlternateScreenActive: () => false,
    });

    expect(scheduler.getWriteChunkBytes()).toBe(XTERM_PERFORMANCE_CONFIG.output.writeChunkBytes);
    expect(scheduler.getForegroundDelayMs()).toBe(0);
  });

  it("uses alternate chunks without FPS delay until severe backlog", () => {
    let queueBytes = XTERM_PERFORMANCE_CONFIG.output.alternateScreenThrottleBacklogBytes;
    let now = 1000;
    const scheduler = new TerminalOutputScheduler({
      getQueueBytes: () => queueBytes,
      isAlternateScreenActive: () => true,
      now: () => now,
    });

    expect(scheduler.getWriteChunkBytes()).toBe(
      XTERM_PERFORMANCE_CONFIG.output.alternateScreenWriteChunkBytes,
    );
    expect(scheduler.getForegroundDelayMs()).toBe(0);

    queueBytes += 1;
    scheduler.noteWriteStart();
    now += 10;

    expect(scheduler.getForegroundDelayMs()).toBeGreaterThan(0);
  });
});
