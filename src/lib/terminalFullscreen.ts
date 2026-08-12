import { invoke } from "@/lib/invoke";
import { logger } from "@/lib/logger";

export const TERMINAL_FULLSCREEN_CHANGED_EVENT = "nyaterm:terminal-fullscreen-changed";

let fullscreenActive = false;

function emitFullscreenChanged(active: boolean): void {
  window.dispatchEvent(
    new CustomEvent(TERMINAL_FULLSCREEN_CHANGED_EVENT, { detail: { active } }),
  );
}

/**
 * Toggle terminal-area fullscreen via a native Windows helper that sizes to
 * `rcMonitor` (covers the taskbar) and disables DWM shadow (removes the left gap).
 */
export async function toggleTerminalWindowFullscreen(): Promise<boolean> {
  const next = !fullscreenActive;
  try {
    await invoke("set_terminal_fullscreen", { enable: next });
    fullscreenActive = next;
    emitFullscreenChanged(next);
    return next;
  } catch (error) {
    fullscreenActive = false;
    emitFullscreenChanged(false);
    logger.error({
      domain: "window.fullscreen",
      event: "window.fullscreen.toggle_failed",
      message: "Failed to toggle terminal fullscreen",
      error,
    });
    throw error;
  }
}

export async function exitTerminalWindowFullscreen(): Promise<void> {
  if (!fullscreenActive) return;
  try {
    await invoke("set_terminal_fullscreen", { enable: false });
  } catch (error) {
    logger.warn({
      domain: "window.fullscreen",
      event: "window.fullscreen.exit_failed",
      message: "Failed to exit terminal fullscreen",
      error,
    });
  } finally {
    fullscreenActive = false;
    emitFullscreenChanged(false);
  }
}

export function isTerminalWindowFullscreenActive(): boolean {
  return fullscreenActive;
}

export async function isTerminalWindowFullscreen(): Promise<boolean> {
  return fullscreenActive;
}
