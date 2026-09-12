import { act, renderHook } from "@testing-library/react";
import type { TFunction } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloneDefaultActivityBarLayout } from "@/lib/appWorkspace";
import type { UiConfig } from "@/types/global";
import { useActivityBarController } from "./useActivityBarController";

const mocks = vi.hoisted(() => ({
  focusTerminalSession: vi.fn(),
  openSettings: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/lib/appSessionFactory", () => ({
  focusTerminalSession: mocks.focusTerminalSession,
}));

vi.mock("@/lib/windowManager", () => ({
  openSettings: mocks.openSettings,
}));

describe("useActivityBarController settings focus", () => {
  beforeEach(() => {
    mocks.focusTerminalSession.mockReset();
    mocks.openSettings.mockReset();
  });

  it("restores the session captured when settings was selected", async () => {
    let resolveSettings: (() => void) | undefined;
    const settingsPromise = new Promise<void>((resolve) => {
      resolveSettings = resolve;
    });
    mocks.openSettings.mockReturnValue(settingsPromise);
    const { result, rerender } = renderController("session-1");

    act(() => result.current.handleItemSelect("settings"));
    rerender({ activeSessionId: "session-2" });

    expect(mocks.openSettings).toHaveBeenCalledOnce();
    expect(mocks.focusTerminalSession).not.toHaveBeenCalled();

    await act(async () => {
      resolveSettings?.();
      await settingsPromise;
    });

    expect(mocks.focusTerminalSession).toHaveBeenCalledOnce();
    expect(mocks.focusTerminalSession).toHaveBeenCalledWith("session-1");
  });

  it("restores focus ownership when opening settings rejects", async () => {
    let rejectSettings: ((reason?: unknown) => void) | undefined;
    const settingsPromise = new Promise<void>((_, reject) => {
      rejectSettings = reject;
    });
    mocks.openSettings.mockReturnValue(settingsPromise);
    const { result } = renderController("session-1");

    act(() => result.current.handleItemSelect("settings"));

    await act(async () => {
      rejectSettings?.(new Error("settings failed"));
      await settingsPromise.catch(() => {});
    });

    expect(mocks.focusTerminalSession).toHaveBeenCalledOnce();
    expect(mocks.focusTerminalSession).toHaveBeenCalledWith("session-1");
  });
});

function renderController(initialActiveSessionId: string | null) {
  const updateUi = vi.fn();
  return renderHook(
    ({ activeSessionId }) =>
      useActivityBarController({
        uiConfig: createUiConfig(),
        activeSessionId,
        recordingSessions: new Set(),
        multiPanelOpen: false,
        panelOpenMode: "docked",
        onFloatingPanelSelect: vi.fn(),
        onFloatingPanelMove: vi.fn(),
        updateUi,
        setIsLocked: vi.fn(),
        t: ((key: string) => key) as TFunction,
      }),
    { initialProps: { activeSessionId: initialActiveSessionId } },
  );
}

function createUiConfig(): UiConfig {
  return {
    activity_bar_layout: cloneDefaultActivityBarLayout(),
    panel_open_mode: "docked",
    active_left_panel: null,
    active_right_panel: null,
    left_open_panels: [],
    right_open_panels: [],
    show_notes_panel: true,
    show_remote_stats: true,
    show_gpu_monitor: true,
    show_ascend_npu_monitor: true,
    show_process_manager: true,
    show_docker_manager: true,
  } as unknown as UiConfig;
}
