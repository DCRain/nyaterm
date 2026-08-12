/** IronRDP / MS-RDPEDISP allow down to 200; width must be even. */
export const RDP_MIN_WIDTH = 200;
export const RDP_MIN_HEIGHT = 200;
export const RDP_MAX_WIDTH = 7680;
export const RDP_MAX_HEIGHT = 4320;

export interface RdpResizeDecisionInput {
  mode?: string | null;
  visible: boolean;
  containerWidth: number;
  containerHeight: number;
  remoteWidth?: number | null;
  remoteHeight?: number | null;
  lastWidth?: number | null;
  lastHeight?: number | null;
  allowInitialResize?: boolean;
  disabled?: boolean;
  minDelta?: number;
}

export interface RdpResizeDecision {
  shouldResize: boolean;
  width: number;
  height: number;
}

export interface RdpResizeFailureInput {
  state: string;
  lastResizeAt?: number | null;
  now: number;
  failureWindowMs?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function evenFloor(value: number) {
  const floored = Math.floor(value);
  return floored % 2 === 0 ? floored : floored - 1;
}

export function normalizeRdpDisplayMode(mode?: string | null): "fit-window" | "fixed" {
  return mode === "fit-window" ? "fit-window" : "fixed";
}

export function decideFitWindowResize(input: RdpResizeDecisionInput): RdpResizeDecision {
  if (input.disabled || normalizeRdpDisplayMode(input.mode) !== "fit-window" || !input.visible) {
    return { shouldResize: false, width: input.lastWidth ?? 0, height: input.lastHeight ?? 0 };
  }

  let width = clamp(evenFloor(input.containerWidth), RDP_MIN_WIDTH, RDP_MAX_WIDTH);
  if (width % 2 !== 0) width = Math.max(RDP_MIN_WIDTH, width - 1);
  const height = clamp(Math.floor(input.containerHeight), RDP_MIN_HEIGHT, RDP_MAX_HEIGHT);
  const minDelta = input.minDelta ?? 0;
  const remoteWidth = input.remoteWidth ?? input.lastWidth;
  const remoteHeight = input.remoteHeight ?? input.lastHeight;
  if (
    minDelta > 0 &&
    remoteWidth != null &&
    remoteHeight != null &&
    Math.abs(remoteWidth - width) < minDelta &&
    Math.abs(remoteHeight - height) < minDelta
  ) {
    return { shouldResize: false, width, height };
  }
  const hasLastSize = input.lastWidth != null && input.lastHeight != null;
  if (!hasLastSize && input.allowInitialResize === false) {
    return { shouldResize: false, width, height };
  }
  const sameSize = input.lastWidth === width && input.lastHeight === height;
  return { shouldResize: !sameSize, width, height };
}

export function shouldDisableDynamicResizeAfterState(input: RdpResizeFailureInput): boolean {
  if (input.state !== "reconnecting" && input.state !== "failed") return false;
  if (input.lastResizeAt == null) return false;
  const failureWindowMs = input.failureWindowMs ?? 3000;
  return input.now - input.lastResizeAt >= 0 && input.now - input.lastResizeAt <= failureWindowMs;
}

export interface RdpDesktopSize {
  width: number;
  height: number;
}

export function keepDesktopSizeIfUnchanged(
  current: RdpDesktopSize,
  next: RdpDesktopSize,
): RdpDesktopSize {
  return current.width === next.width && current.height === next.height ? current : next;
}
