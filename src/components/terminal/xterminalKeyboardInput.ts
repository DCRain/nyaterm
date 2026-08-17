import type { SessionType } from "@/types/global";

const LEGACY_CTRL_KEYS = new Set([" ", "@", "[", "\\", "]", "^", "_", "?"]);

export function getCtrlPrintableCsiuInput(e: KeyboardEvent): string | null {
  if (!e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return null;

  const codePoint = e.key.codePointAt(0);
  if (!codePoint || codePoint < 0x20 || codePoint > 0x7e) return null;

  if (
    /^[a-z]$/i.test(e.key) ||
    /^[2-8]$/.test(e.key) ||
    LEGACY_CTRL_KEYS.has(e.key)
  ) {
    return null;
  }

  const modifier = 1 + 4 + (e.shiftKey ? 1 : 0);
  return `\x1b[${codePoint};${modifier}u`;
}

export function isLocalBackspaceEvent(
  event: KeyboardEvent,
  sessionType: SessionType,
): boolean {
  if (
    sessionType !== "Local" ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  ) {
    return false;
  }

  return (
    event.key === "Backspace" ||
    (event.key === "Delete" && event.code === "Backspace")
  );
}

export function isSessionNotFoundError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error ?? "");
  return (
    message.toLowerCase().includes("session") &&
    message.toLowerCase().includes("not found")
  );
}
