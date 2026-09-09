import { renderHook, waitFor } from "@testing-library/react";
import type { Terminal } from "@xterm/xterm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalFitScheduler } from "./terminalFitScheduler";
import { useTerminalRefreshEffects } from "./useTerminalRefreshEffects";

const windowMocks = vi.hoisted(() => ({
  focusChanged: undefined as ((event: { payload: boolean }) => void) | undefined,
  scaleChanged: undefined as
    | ((event: { payload: { scaleFactor: number } }) => void)
    | undefined,
}));

function createTerminal(baseY = 0, viewportY = baseY) {
  const scrollToBottom = vi.fn();
  return {
    terminal: {
      buffer: { active: { baseY, viewportY } },
      scrollToBottom,
    } as unknown as Terminal,
    scrollToBottom,
  };
}

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onResized: async () => vi.fn(),
    onMoved: async () => vi.fn(),
    onFocusChanged: async (callback: (event: { payload: boolean }) => void) => {
      windowMocks.focusChanged = callback;
      return vi.fn();
    },
    onScaleChanged: async (
      callback: (event: { payload: { scaleFactor: number } }) => void,
    ) => {
      windowMocks.scaleChanged = callback;
      return vi.fn();
    },
  }),
}));

describe("useTerminalRefreshEffects", () => {
  beforeEach(() => {
    windowMocks.focusChanged = undefined;
    windowMocks.scaleChanged = undefined;
  });

  it("restores the bottom viewport after an active terminal fit", () => {
    const schedule = vi.fn();
    const { terminal, scrollToBottom } = createTerminal(12, 12);
    renderHook(() =>
      useTerminalRefreshEffects({
        terminalRef: { current: terminal },
        fitSchedulerRef: {
          current: { schedule } as unknown as TerminalFitScheduler,
        },
        active: true,
        visible: true,
        terminalReady: true,
        performanceMode: "normal",
        sessionId: "session-1",
        showGutter: false,
        showContentPadding: false,
      }),
    );

    const activeRefresh = schedule.mock.calls
      .map(([request]) => request)
      .find((request) => request.reason === "active");
    expect(activeRefresh).toEqual(
      expect.objectContaining({ force: true, refresh: true, focus: true }),
    );
    expect(activeRefresh).not.toHaveProperty("clearTextureAtlas");
    activeRefresh.onComplete({ applied: true });
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("preserves manual scrollback after an active terminal fit", () => {
    const schedule = vi.fn();
    const { terminal, scrollToBottom } = createTerminal(12, 4);
    renderHook(() =>
      useTerminalRefreshEffects({
        terminalRef: { current: terminal },
        fitSchedulerRef: {
          current: { schedule } as unknown as TerminalFitScheduler,
        },
        active: true,
        visible: true,
        terminalReady: true,
        performanceMode: "normal",
        sessionId: "session-1",
        showGutter: false,
        showContentPadding: false,
      }),
    );

    const activeRefresh = schedule.mock.calls
      .map(([request]) => request)
      .find((request) => request.reason === "active");
    activeRefresh.onComplete({ applied: true });
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("does not change the viewport when an active terminal fit is skipped", () => {
    const schedule = vi.fn();
    const { terminal, scrollToBottom } = createTerminal(12, 12);
    renderHook(() =>
      useTerminalRefreshEffects({
        terminalRef: { current: terminal },
        fitSchedulerRef: {
          current: { schedule } as unknown as TerminalFitScheduler,
        },
        active: true,
        visible: true,
        terminalReady: true,
        performanceMode: "normal",
        sessionId: "session-1",
        showGutter: false,
        showContentPadding: false,
      }),
    );

    const activeRefresh = schedule.mock.calls
      .map(([request]) => request)
      .find((request) => request.reason === "active");
    activeRefresh.onComplete({ applied: false });
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("forces fit and repaint without stealing focus when the native window regains focus", async () => {
    const schedule = vi.fn();
    const { terminal } = createTerminal();
    renderHook(() =>
      useTerminalRefreshEffects({
        terminalRef: { current: terminal },
        fitSchedulerRef: {
          current: { schedule } as unknown as TerminalFitScheduler,
        },
        active: true,
        visible: true,
        terminalReady: true,
        performanceMode: "normal",
        sessionId: "session-1",
        showGutter: false,
        showContentPadding: false,
      }),
    );
    await waitFor(() => expect(windowMocks.focusChanged).toBeTypeOf("function"));
    schedule.mockClear();

    windowMocks.focusChanged?.({ payload: false });
    expect(schedule).not.toHaveBeenCalled();

    windowMocks.focusChanged?.({ payload: true });
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "window-focus",
        force: true,
        refresh: true,
        clearTextureAtlas: false,
        focus: false,
      }),
    );
  });

  it("still invalidates textures after a DPI scale change", async () => {
    const schedule = vi.fn();
    const { terminal } = createTerminal();
    renderHook(() =>
      useTerminalRefreshEffects({
        terminalRef: { current: terminal },
        fitSchedulerRef: {
          current: { schedule } as unknown as TerminalFitScheduler,
        },
        active: true,
        visible: true,
        terminalReady: true,
        performanceMode: "normal",
        sessionId: "session-1",
        showGutter: false,
        showContentPadding: false,
      }),
    );
    await waitFor(() =>
      expect(windowMocks.scaleChanged).toBeTypeOf("function"),
    );
    windowMocks.scaleChanged?.({ payload: { scaleFactor: 2 } });

    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "scale-factor",
        force: true,
        refresh: true,
        clearTextureAtlas: true,
      }),
    );
  });

  it("suppresses incidental refreshes while a snapshot restore is finalizing", async () => {
    const schedule = vi.fn();
    const snapshotRestoringRef = { current: true };
    const { terminal } = createTerminal();
    renderHook(() =>
      useTerminalRefreshEffects({
        terminalRef: { current: terminal },
        fitSchedulerRef: {
          current: { schedule } as unknown as TerminalFitScheduler,
        },
        active: true,
        visible: true,
        terminalReady: true,
        performanceMode: "normal",
        sessionId: "session-1",
        showGutter: false,
        showContentPadding: false,
        snapshotRestoringRef,
      }),
    );
    await waitFor(() =>
      expect(windowMocks.scaleChanged).toBeTypeOf("function"),
    );
    schedule.mockClear();

    window.dispatchEvent(new Event("nyaterm:refresh-terminals"));
    windowMocks.scaleChanged?.({ payload: { scaleFactor: 2 } });

    expect(schedule).not.toHaveBeenCalled();
  });
});
