import { XTERM_PERFORMANCE_CONFIG } from "@/lib/xtermPerformance";

export interface TerminalOutputSchedulerOptions {
  getQueueBytes: () => number;
  isAlternateScreenActive: () => boolean;
  now?: () => number;
}

export interface TerminalOutputSchedulingSnapshot {
  alternateScreen: boolean;
  queueBytes: number;
  severeBacklog: boolean;
  writeChunkBytes: number;
  foregroundDelayMs: number;
}

export class TerminalOutputScheduler {
  private lastAlternateScreenWriteAt = 0;
  private readonly now: () => number;

  constructor(private readonly options: TerminalOutputSchedulerOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  getWriteChunkBytes() {
    return this.options.isAlternateScreenActive()
      ? XTERM_PERFORMANCE_CONFIG.output.alternateScreenWriteChunkBytes
      : XTERM_PERFORMANCE_CONFIG.output.writeChunkBytes;
  }

  getForegroundDelayMs() {
    if (!this.shouldUseSevereAlternateScreenThrottle()) return 0;

    const intervalMs = 1000 / XTERM_PERFORMANCE_CONFIG.output.alternateScreenMaxWriteFps;
    const elapsedMs = this.now() - this.lastAlternateScreenWriteAt;
    return this.lastAlternateScreenWriteAt > 0 && elapsedMs < intervalMs
      ? Math.max(1, intervalMs - elapsedMs)
      : 0;
  }

  noteWriteStart() {
    if (this.options.isAlternateScreenActive()) {
      this.lastAlternateScreenWriteAt = this.now();
    }
  }

  reset() {
    this.lastAlternateScreenWriteAt = 0;
  }

  snapshot(): TerminalOutputSchedulingSnapshot {
    const queueBytes = this.options.getQueueBytes();
    const alternateScreen = this.options.isAlternateScreenActive();
    const severeBacklog =
      alternateScreen &&
      queueBytes > XTERM_PERFORMANCE_CONFIG.output.alternateScreenThrottleBacklogBytes;

    return {
      alternateScreen,
      queueBytes,
      severeBacklog,
      writeChunkBytes: this.getWriteChunkBytes(),
      foregroundDelayMs: this.getForegroundDelayMs(),
    };
  }

  private shouldUseSevereAlternateScreenThrottle() {
    return (
      this.options.isAlternateScreenActive() &&
      this.options.getQueueBytes() >
        XTERM_PERFORMANCE_CONFIG.output.alternateScreenThrottleBacklogBytes
    );
  }
}
