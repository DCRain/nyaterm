import { XTERM_PERFORMANCE_CONFIG } from "@/lib/xtermPerformance";
import type { QueuedOutputChunk } from "./xterminalOutputQueue";

export type Dec2026FrameGateMode = "off" | "shadow" | "collapse";

export type Dec2026FrameClassification =
  | {
      kind: "replaceable-visual";
      bytes: number;
      successorProof: "self-contained-replacement" | "none";
    }
  | {
      kind: "stateful";
      bytes: number;
      reason: string;
    }
  | {
      kind: "unknown";
      bytes: number;
      reason: string;
    };

export interface Dec2026FrameGateSnapshot {
  mode: Dec2026FrameGateMode;
  framesSeen: number;
  completeFrames: number;
  partialFrames: number;
  candidateFrames: number;
  replaceableFrames: number;
  wouldDropFrames: number;
  wouldDropBytes: number;
  droppedFrames: number;
  droppedBytes: number;
  statefulFrames: number;
  malformedFrames: number;
  failOpenCandidates: number;
  maxFrameBytes: number;
  heldBytes: number;
  lastRejectReason: string | null;
  lastCandidateContext: Dec2026FrameCandidateContext | null;
}

export interface Dec2026FrameCandidateContext {
  outputDrainPendingBytes: number;
  outputDrainQueueBytes: number;
  frameGateHeldBytes: number;
  alternateScreen: boolean;
  performanceMode: string;
}

interface Dec2026FrameGateOptions {
  mode: Dec2026FrameGateMode;
  forward: (chunk: QueuedOutputChunk) => void;
  ackDropped: (bytes: number) => void;
  getPressureSnapshot: () => Dec2026FrameCandidateContext;
  onPressureChange?: () => void;
  logDebug?: (event: string, message: string, data?: Record<string, unknown>) => void;
  setTimeout?: (callback: () => void, delay: number) => number;
  clearTimeout?: (handle: number) => void;
}

interface Dec2026CompleteFrame {
  data: string;
  content: string;
  bytes: number;
  classification: Dec2026FrameClassification;
}

interface Dec2026Boundary {
  index: number;
  sequence: string;
  kind: "begin" | "end";
}

const DEC2026_BEGIN_ESC = "\x1b[?2026h";
const DEC2026_END_ESC = "\x1b[?2026l";
const DEC2026_BEGIN_C1 = "\x9b?2026h";
const DEC2026_END_C1 = "\x9b?2026l";
const DEC2026_SEQUENCES = [
  DEC2026_BEGIN_ESC,
  DEC2026_END_ESC,
  DEC2026_BEGIN_C1,
  DEC2026_END_C1,
] as const;

const MAX_PENDING_CSI_CHARS = 64;
const DEFAULT_PARTIAL_FRAME_FAIL_OPEN_MS = 200;
const DEFAULT_MAX_HELD_FRAME_BYTES = 512 * 1024;

const textEncoder = new TextEncoder();

function utf8ByteLength(text: string): number {
  return textEncoder.encode(text).length;
}

export function resolveDec2026FrameGateMode(): Dec2026FrameGateMode {
  const requested = import.meta.env.VITE_NYATERM_DEC2026_FRAME_GATE;
  if (requested === "off" || requested === "shadow" || requested === "collapse") {
    return requested;
  }
  return import.meta.env.DEV ? "shadow" : "off";
}

function boundaryKind(sequence: string): "begin" | "end" {
  return sequence.endsWith("h") ? "begin" : "end";
}

function findNextBoundary(text: string, startIndex: number): Dec2026Boundary | null {
  let next: Dec2026Boundary | null = null;
  for (const sequence of DEC2026_SEQUENCES) {
    const index = text.indexOf(sequence, startIndex);
    if (index < 0) continue;
    if (!next || index < next.index || (index === next.index && sequence.length > next.sequence.length)) {
      next = { index, sequence, kind: boundaryKind(sequence) };
    }
  }
  return next;
}

function pendingBoundarySuffix(text: string): string {
  const max = Math.min(MAX_PENDING_CSI_CHARS, text.length);
  for (let length = max; length > 0; length -= 1) {
    const suffix = text.slice(text.length - length);
    if (DEC2026_SEQUENCES.some((sequence) => sequence.startsWith(suffix))) {
      return suffix;
    }
  }
  return "";
}

function parseCsi(
  text: string,
  index: number,
): { endIndex: number; params: string; intermediates: string; final: string; raw: string } | null {
  const isC1 = text.charCodeAt(index) === 0x9b;
  const start = isC1 ? index + 1 : index + 2;
  let cursor = start;
  let params = "";
  let intermediates = "";

  while (cursor < text.length) {
    const code = text.charCodeAt(cursor);
    if (code >= 0x30 && code <= 0x3f && intermediates.length === 0) {
      params += text[cursor];
      cursor += 1;
      continue;
    }
    if (code >= 0x20 && code <= 0x2f) {
      intermediates += text[cursor];
      cursor += 1;
      continue;
    }
    if (code >= 0x40 && code <= 0x7e) {
      const final = text[cursor];
      const raw = text.slice(index, cursor + 1);
      return { endIndex: cursor + 1, params, intermediates, final, raw };
    }
    return null;
  }

  return null;
}

function numericParams(params: string): string[] {
  return params.length === 0 ? [] : params.split(";");
}

function hasPrivateMarker(params: string): boolean {
  return params.includes("?") || params.includes(">") || params.includes("<") || params.includes("=");
}

function isDeviceReport(final: string): boolean {
  return final === "c" || final === "n";
}

function isAllowedCursorCsi(final: string, params: string): boolean {
  if (!"ABCDEFGHfd`".includes(final)) return false;
  if (hasPrivateMarker(params)) return false;
  return numericParams(params).every((param) => param === "" || /^\d+$/u.test(param));
}

function isAllowedEraseCsi(final: string, params: string): boolean {
  if (final !== "J" && final !== "K") return false;
  if (hasPrivateMarker(params)) return false;
  const parts = numericParams(params);
  if (!parts.every((param) => param === "" || /^\d+$/u.test(param))) return false;
  if (final === "J" && parts.some((param) => param === "3")) return false;
  return true;
}

function isSgrReset(csi: { params: string; final: string; raw: string }): boolean {
  return csi.final === "m" && csi.params === "0" && csi.raw.endsWith("0m");
}

function isEd2(csi: { params: string; final: string }): boolean {
  return csi.final === "J" && csi.params === "2";
}

function isHome(csi: { params: string; final: string }): boolean {
  if (csi.final === "H") {
    return csi.params === "" || csi.params === "1;1";
  }
  return csi.final === "f" && csi.params === "1;1";
}

function classifyCsi(csi: {
  params: string;
  intermediates: string;
  final: string;
}): "allowed" | { kind: "stateful" | "unknown"; reason: string } {
  if (csi.intermediates.length > 0) {
    return { kind: "unknown", reason: "csi-intermediate" };
  }
  if (isDeviceReport(csi.final)) {
    return { kind: "stateful", reason: "device-report" };
  }
  if (csi.final === "h" || csi.final === "l") {
    return { kind: "stateful", reason: "mode-change" };
  }
  if (csi.final === "r") {
    return { kind: "stateful", reason: "scroll-region" };
  }
  if ("@LMP".includes(csi.final)) {
    return { kind: "stateful", reason: "insert-delete" };
  }
  if (csi.final === "S" || csi.final === "T") {
    return { kind: "stateful", reason: "scroll-up-down" };
  }
  if (csi.final === "m") {
    return hasPrivateMarker(csi.params)
      ? { kind: "unknown", reason: "private-sgr" }
      : "allowed";
  }
  if (isAllowedCursorCsi(csi.final, csi.params)) return "allowed";
  if (csi.final === "J" && numericParams(csi.params).some((param) => param === "3")) {
    return { kind: "stateful", reason: "clear-scrollback" };
  }
  if (isAllowedEraseCsi(csi.final, csi.params)) {
    return "allowed";
  }
  return { kind: "unknown", reason: `unknown-csi-${csi.final}` };
}

export function classifyDec2026Frame(
  content: string,
  frameBytes = utf8ByteLength(content),
): Dec2026FrameClassification {
  let sawResetBeforeEd2 = false;
  let sawEd2AfterReset = false;
  let sawHomeBeforePrintable = false;
  let sawPrintable = false;

  for (let index = 0; index < content.length; ) {
    const code = content.charCodeAt(index);

    if (code === 0x1b) {
      const next = content[index + 1];
      if (next === "[") {
        const csi = parseCsi(content, index);
        if (!csi) return { kind: "unknown", bytes: frameBytes, reason: "malformed-csi" };
        const result = classifyCsi(csi);
        if (result !== "allowed") {
          return { kind: result.kind, bytes: frameBytes, reason: result.reason };
        }
        if (!sawPrintable) {
          if (isSgrReset(csi)) sawResetBeforeEd2 = true;
          if (sawResetBeforeEd2 && isEd2(csi)) sawEd2AfterReset = true;
          if (isHome(csi)) sawHomeBeforePrintable = true;
        }
        index = csi.endIndex;
        continue;
      }
      if (next === "]") return { kind: "stateful", bytes: frameBytes, reason: "osc" };
      if (next === "P") return { kind: "stateful", bytes: frameBytes, reason: "dcs" };
      if (next === "_") return { kind: "stateful", bytes: frameBytes, reason: "apc" };
      if (next === "^") return { kind: "stateful", bytes: frameBytes, reason: "pm" };
      if (next === "X") return { kind: "stateful", bytes: frameBytes, reason: "sos" };
      if (next === "c") return { kind: "stateful", bytes: frameBytes, reason: "ris" };
      return { kind: "unknown", bytes: frameBytes, reason: "unknown-esc" };
    }

    if (code === 0x9b) {
      const csi = parseCsi(content, index);
      if (!csi) return { kind: "unknown", bytes: frameBytes, reason: "malformed-c1-csi" };
      const result = classifyCsi(csi);
      if (result !== "allowed") {
        return { kind: result.kind, bytes: frameBytes, reason: result.reason };
      }
      if (!sawPrintable) {
        if (isSgrReset(csi)) sawResetBeforeEd2 = true;
        if (sawResetBeforeEd2 && isEd2(csi)) sawEd2AfterReset = true;
        if (isHome(csi)) sawHomeBeforePrintable = true;
      }
      index = csi.endIndex;
      continue;
    }

    if (code === 0x9d) return { kind: "stateful", bytes: frameBytes, reason: "c1-osc" };
    if (code === 0x90) return { kind: "stateful", bytes: frameBytes, reason: "c1-dcs" };
    if (code === 0x9f) return { kind: "stateful", bytes: frameBytes, reason: "c1-apc" };
    if (code === 0x9e) return { kind: "stateful", bytes: frameBytes, reason: "c1-pm" };
    if (code === 0x98) return { kind: "stateful", bytes: frameBytes, reason: "c1-sos" };

    if (code === 0x0d || code === 0x09 || code === 0x08) {
      index += 1;
      continue;
    }
    if (code === 0x0a) return { kind: "stateful", bytes: frameBytes, reason: "lf" };
    if (code === 0x07) return { kind: "stateful", bytes: frameBytes, reason: "bel" };
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      return { kind: "unknown", bytes: frameBytes, reason: "unknown-control" };
    }

    sawPrintable = true;
    const codePoint = content.codePointAt(index) ?? code;
    index += codePoint > 0xffff ? 2 : 1;
  }

  return {
    kind: "replaceable-visual",
    bytes: frameBytes,
    successorProof:
      sawResetBeforeEd2 && sawEd2AfterReset && sawHomeBeforePrintable
        ? "self-contained-replacement"
        : "none",
  };
}

export class Dec2026FrameGate {
  private readonly setTimer: (callback: () => void, delay: number) => number;
  private readonly clearTimer: (handle: number) => void;
  private pendingPrefix = "";
  private currentFrameData = "";
  private currentFrameContent = "";
  private heldFrame: Dec2026CompleteFrame | null = null;
  private shadowPendingPrefix = "";
  private shadowCurrentFrameData = "";
  private shadowCurrentFrameContent = "";
  private shadowHeldFrame: Dec2026CompleteFrame | null = null;
  private failOpenTimer: number | null = null;
  private disposed = false;
  private snapshotState: Dec2026FrameGateSnapshot;

  constructor(private readonly options: Dec2026FrameGateOptions) {
    this.setTimer = options.setTimeout ?? ((callback, delay) => window.setTimeout(callback, delay));
    this.clearTimer = options.clearTimeout ?? ((handle) => window.clearTimeout(handle));
    this.snapshotState = {
      mode: options.mode,
      framesSeen: 0,
      completeFrames: 0,
      partialFrames: 0,
      candidateFrames: 0,
      replaceableFrames: 0,
      wouldDropFrames: 0,
      wouldDropBytes: 0,
      droppedFrames: 0,
      droppedBytes: 0,
      statefulFrames: 0,
      malformedFrames: 0,
      failOpenCandidates: 0,
      maxFrameBytes: 0,
      heldBytes: 0,
      lastRejectReason: null,
      lastCandidateContext: null,
    };
  }

  enqueue(chunk: QueuedOutputChunk) {
    if (this.disposed || chunk.bytes <= 0 || !chunk.data) return;
    if (chunk.bytes !== utf8ByteLength(chunk.data)) {
      this.failOpen("byte-mismatch");
      this.options.forward(chunk);
      return;
    }
    if (this.options.mode === "off") {
      this.options.forward(chunk);
      return;
    }
    if (this.options.mode === "shadow") {
      this.scanShadow(chunk.data);
      this.options.forward(chunk);
      return;
    }
    if (!this.canCollapseNow()) {
      this.scanShadow(chunk.data);
      this.flush("pressure-open");
      this.options.forward(chunk);
      return;
    }
    this.processCollapseText(chunk.data);
    this.updateHeldBytes();
  }

  flush(reason = "flush") {
    if (this.disposed) return;
    this.clearFailOpenTimer();
    this.forwardText(this.pendingPrefix);
    this.pendingPrefix = "";
    this.forwardText(this.currentFrameData);
    this.currentFrameData = "";
    this.currentFrameContent = "";
    if (this.heldFrame) {
      this.forwardText(this.heldFrame.data);
      this.heldFrame = null;
    }
    this.options.logDebug?.("terminal.dec2026_frame_gate.flush", "Flushed DEC 2026 frame gate", {
      reason,
    });
    this.updateHeldBytes();
  }

  dispose(options: { ackRemaining?: boolean; reason?: string } = {}) {
    if (this.disposed) return;
    this.disposed = true;
    this.clearFailOpenTimer();
    const remainingBytes = this.getHeldBytes();
    if (options.ackRemaining && remainingBytes > 0) {
      this.options.ackDropped(remainingBytes);
      this.options.logDebug?.(
        "terminal.dec2026_frame_gate.teardown_ack",
        "ACKed gate-owned bytes during terminal teardown",
        { reason: options.reason ?? "dispose", bytes: remainingBytes },
      );
    } else {
      this.forwardText(this.pendingPrefix);
      this.forwardText(this.currentFrameData);
      if (this.heldFrame) this.forwardText(this.heldFrame.data);
    }
    this.pendingPrefix = "";
    this.currentFrameData = "";
    this.currentFrameContent = "";
    this.heldFrame = null;
    this.shadowPendingPrefix = "";
    this.shadowCurrentFrameData = "";
    this.shadowCurrentFrameContent = "";
    this.shadowHeldFrame = null;
    this.updateHeldBytes();
  }

  reset() {
    this.clearFailOpenTimer();
    this.pendingPrefix = "";
    this.currentFrameData = "";
    this.currentFrameContent = "";
    this.heldFrame = null;
    this.shadowPendingPrefix = "";
    this.shadowCurrentFrameData = "";
    this.shadowCurrentFrameContent = "";
    this.shadowHeldFrame = null;
    this.updateHeldBytes();
  }

  getHeldBytes() {
    return (
      utf8ByteLength(this.pendingPrefix) +
      utf8ByteLength(this.currentFrameData) +
      (this.heldFrame?.bytes ?? 0)
    );
  }

  snapshot(): Dec2026FrameGateSnapshot {
    this.updateHeldBytes();
    return { ...this.snapshotState };
  }

  private scanShadow(data: string) {
    const previousPrefix = this.pendingPrefix;
    const previousFrameData = this.currentFrameData;
    const previousFrameContent = this.currentFrameContent;
    const previousHeldFrame = this.heldFrame;
    const previousTimer = this.failOpenTimer;
    this.failOpenTimer = null;
    this.pendingPrefix = this.shadowPendingPrefix;
    this.currentFrameData = this.shadowCurrentFrameData;
    this.currentFrameContent = this.shadowCurrentFrameContent;
    this.processCollapseText(data, true);
    this.shadowPendingPrefix = this.pendingPrefix;
    this.shadowCurrentFrameData = this.currentFrameData;
    this.shadowCurrentFrameContent = this.currentFrameContent;
    this.pendingPrefix = previousPrefix;
    this.currentFrameData = previousFrameData;
    this.currentFrameContent = previousFrameContent;
    this.heldFrame = previousHeldFrame;
    this.failOpenTimer = previousTimer;
    this.updateHeldBytes();
  }

  private processCollapseText(data: string, shadow = false) {
    let text = `${this.pendingPrefix}${data}`;
    this.pendingPrefix = "";

    while (text.length > 0) {
      if (this.currentFrameData) {
        const boundary = findNextBoundary(text, 0);
        if (!boundary) {
          this.appendCurrentFrame(text, shadow);
          text = "";
          break;
        }
        const before = text.slice(0, boundary.index);
        this.appendCurrentFrame(before, shadow);
        if (boundary.kind === "begin") {
          this.snapshotState.malformedFrames += 1;
          this.snapshotState.failOpenCandidates += 1;
          if (shadow) {
            this.shadowHeldFrame = null;
          } else {
            this.flush("nested-open");
            this.forwardText(boundary.sequence);
          }
          text = text.slice(boundary.index + boundary.sequence.length);
          continue;
        }
        this.currentFrameData += boundary.sequence;
        const frameData = this.currentFrameData;
        const frameContent = this.currentFrameContent;
        this.currentFrameData = "";
        this.currentFrameContent = "";
        this.handleCompleteFrame(frameData, frameContent, shadow);
        text = text.slice(boundary.index + boundary.sequence.length);
        continue;
      }

      const boundary = findNextBoundary(text, 0);
      if (!boundary) {
        const suffix = pendingBoundarySuffix(text);
        const barrier = suffix ? text.slice(0, -suffix.length) : text;
        this.handleBarrier(barrier, shadow);
        this.pendingPrefix = suffix;
        text = "";
        break;
      }

      const before = text.slice(0, boundary.index);
      this.handleBarrier(before, shadow);
      if (boundary.kind === "end") {
        this.snapshotState.failOpenCandidates += 1;
        this.handleBarrier(boundary.sequence, shadow);
        text = text.slice(boundary.index + boundary.sequence.length);
        continue;
      }
      this.snapshotState.framesSeen += 1;
      this.snapshotState.partialFrames += 1;
      if (shadow) {
        this.currentFrameData = boundary.sequence;
        this.currentFrameContent = "";
      } else {
        this.currentFrameData = boundary.sequence;
        this.currentFrameContent = "";
        this.scheduleFailOpenTimer();
      }
      text = text.slice(boundary.index + boundary.sequence.length);
    }

    if (!shadow && this.getHeldBytes() >= DEFAULT_MAX_HELD_FRAME_BYTES) {
      this.failOpen("held-byte-cap");
    }
  }

  private appendCurrentFrame(text: string, shadow: boolean) {
    if (!text) return;
    this.currentFrameData += text;
    this.currentFrameContent += text;
    if (!shadow && utf8ByteLength(this.currentFrameData) >= DEFAULT_MAX_HELD_FRAME_BYTES) {
      this.failOpen("partial-byte-cap");
    }
  }

  private handleBarrier(text: string, shadow: boolean) {
    if (!text) return;
    if (shadow) {
      this.shadowHeldFrame = null;
      return;
    }
    this.flush("barrier");
    this.forwardText(text);
  }

  private handleCompleteFrame(frameData: string, frameContent: string, shadow: boolean) {
    const bytes = utf8ByteLength(frameData);
    const contentBytes = utf8ByteLength(frameContent);
    const classification = classifyDec2026Frame(frameContent, bytes);
    const frame = { data: frameData, content: frameContent, bytes, classification };
    this.snapshotState.completeFrames += 1;
    this.snapshotState.maxFrameBytes = Math.max(this.snapshotState.maxFrameBytes, bytes);
    this.recordClassification(classification, contentBytes);

    if (shadow) {
      this.simulateShadowFrame(frame);
      return;
    }

    if (classification.kind !== "replaceable-visual") {
      this.snapshotState.lastRejectReason = classification.reason;
      this.flush("stateful-frame");
      this.forwardText(frame.data);
      return;
    }

    this.snapshotState.lastCandidateContext = this.options.getPressureSnapshot();
    if (this.heldFrame) {
      if (classification.successorProof === "self-contained-replacement") {
        this.dropHeldFrame("successor-replacement");
      } else {
        this.forwardText(this.heldFrame.data);
        this.heldFrame = null;
      }
    }
    this.heldFrame = frame;
    this.scheduleFailOpenTimer();
    this.updateHeldBytes();
  }

  private simulateShadowFrame(frame: Dec2026CompleteFrame) {
    if (frame.classification.kind !== "replaceable-visual") {
      this.shadowHeldFrame = null;
      return;
    }
    this.snapshotState.lastCandidateContext = this.options.getPressureSnapshot();
    if (
      this.canCollapseNow() &&
      this.shadowHeldFrame &&
      frame.classification.successorProof === "self-contained-replacement"
    ) {
      this.snapshotState.wouldDropFrames += 1;
      this.snapshotState.wouldDropBytes += this.shadowHeldFrame.bytes;
    }
    this.shadowHeldFrame = this.canCollapseNow() ? frame : null;
  }

  private recordClassification(classification: Dec2026FrameClassification, contentBytes: number) {
    if (classification.kind === "replaceable-visual") {
      this.snapshotState.candidateFrames += 1;
      if (classification.successorProof === "self-contained-replacement") {
        this.snapshotState.replaceableFrames += 1;
      }
      return;
    }
    this.snapshotState.lastRejectReason = classification.reason;
    if (classification.kind === "stateful") {
      this.snapshotState.statefulFrames += 1;
      return;
    }
    this.snapshotState.malformedFrames += contentBytes > MAX_PENDING_CSI_CHARS ? 1 : 0;
  }

  private canCollapseNow() {
    if (this.options.mode !== "collapse") return false;
    const pressure = this.options.getPressureSnapshot();
    return (
      pressure.alternateScreen &&
      pressure.outputDrainQueueBytes + pressure.frameGateHeldBytes >
        XTERM_PERFORMANCE_CONFIG.output.alternateScreenThrottleBacklogBytes
    );
  }

  private dropHeldFrame(reason: string) {
    if (!this.heldFrame) return;
    const bytes = this.heldFrame.bytes;
    this.options.ackDropped(bytes);
    this.snapshotState.wouldDropFrames += 1;
    this.snapshotState.wouldDropBytes += bytes;
    this.snapshotState.droppedFrames += 1;
    this.snapshotState.droppedBytes += bytes;
    this.options.logDebug?.(
      "terminal.dec2026_frame_gate.drop",
      "Dropped stale DEC 2026 frame",
      { reason, bytes },
    );
    this.heldFrame = null;
    this.updateHeldBytes();
  }

  private failOpen(reason: string) {
    this.snapshotState.failOpenCandidates += 1;
    this.options.logDebug?.(
      "terminal.dec2026_frame_gate.fail_open",
      "Fail-open forwarded DEC 2026 frame gate data",
      { reason, held_bytes: this.getHeldBytes() },
    );
    this.flush(reason);
  }

  private forwardText(text: string) {
    if (!text) return;
    this.options.forward({ data: text, bytes: utf8ByteLength(text) });
  }

  private scheduleFailOpenTimer() {
    this.clearFailOpenTimer();
    this.failOpenTimer = this.setTimer(() => {
      this.failOpenTimer = null;
      this.failOpen("timeout");
    }, DEFAULT_PARTIAL_FRAME_FAIL_OPEN_MS);
  }

  private clearFailOpenTimer() {
    if (this.failOpenTimer === null) return;
    this.clearTimer(this.failOpenTimer);
    this.failOpenTimer = null;
  }

  private updateHeldBytes() {
    this.snapshotState.heldBytes = this.getHeldBytes();
    this.options.onPressureChange?.();
  }
}
