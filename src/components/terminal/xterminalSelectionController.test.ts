import type { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalAppSettings } from "@/context/AppContext";
import type { TerminalInputState } from "@/lib/terminalInputTracker";
import { installXTerminalSelectionController } from "./xterminalSelectionController";

function createHarness(
  options: { isMacOS?: boolean; isWindows?: boolean } = {},
) {
  const { isMacOS = false, isWindows = true } = options;
  const containerEl = document.createElement("div");
  const xtermTarget = document.createElement("div");
  const textarea = document.createElement("textarea");
  const otherControl = document.createElement("button");
  containerEl.append(xtermTarget, textarea);
  document.body.append(containerEl, otherControl);

  const pasteClipboard = vi.fn(() => Promise.resolve());
  const pasteText = vi.fn();
  const removeLinkPopup = vi.fn();
  const clearSearchSelectionState = vi.fn();
  const terminal = {
    textarea,
    clearSelection: vi.fn(),
    focus: vi.fn(() => textarea.focus()),
    getSelection: vi.fn(() => ""),
    onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as Terminal;

  const controller = installXTerminalSelectionController({
    terminal,
    containerEl,
    isMacOS,
    isWindows,
    activeRef: { current: true },
    visibleRef: { current: true },
    terminalAppSettingsRef: {
      current: { keybindings: {} } as TerminalAppSettings,
    },
    pendingSearchSelectionRef: { current: false },
    searchSelectionTextRef: { current: null },
    lastSelectionRef: { current: "" },
    disconnectedRef: { current: false },
    aiCapturingRef: { current: false },
    inputStateRef: { current: {} as TerminalInputState },
    isTerminalAlive: () => true,
    removeLinkPopup,
    clearSearchSelectionState,
    getSmartCursorSelectedInputRange: () => null,
    moveInputCursorAfterSelection: vi.fn(),
    canUseSmartCursor: () => false,
    moveInputCursor: vi.fn(),
    pasteText,
    pasteClipboard,
  });

  return {
    clearSearchSelectionState,
    controller,
    otherControl,
    pasteClipboard,
    pasteText,
    removeLinkPopup,
    terminal,
    textarea,
    xtermTarget,
  };
}

function dispatchMouse(target: HTMLElement, type: "mousedown" | "mouseup", button: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button,
  });
  target.dispatchEvent(event);
  return event;
}

function dispatchSyntheticWinVPaste() {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: "",
    ctrlKey: true,
    key: "v",
  });
  window.dispatchEvent(event);
  return event;
}

function dispatchPhysicalCtrlV() {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: "KeyV",
    ctrlKey: true,
    key: "v",
  });
  window.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("installXTerminalSelectionController", () => {
  it("blocks Windows middle mousedown before it reaches xterm and still pastes on mouseup", () => {
    const {
      clearSearchSelectionState,
      controller,
      otherControl,
      pasteClipboard,
      removeLinkPopup,
      terminal,
      textarea,
      xtermTarget,
    } = createHarness();
    const xtermMouseDown = vi.fn();
    xtermTarget.addEventListener("mousedown", xtermMouseDown);
    otherControl.focus();
    expect(document.activeElement).toBe(otherControl);

    const mouseDown = dispatchMouse(xtermTarget, "mousedown", 1);
    dispatchMouse(xtermTarget, "mouseup", 1);

    expect(mouseDown.defaultPrevented).toBe(true);
    expect(xtermMouseDown).not.toHaveBeenCalled();
    expect(terminal.focus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(textarea);
    expect(removeLinkPopup).toHaveBeenCalledOnce();
    expect(clearSearchSelectionState).toHaveBeenCalledOnce();
    expect(pasteClipboard).toHaveBeenCalledOnce();
    controller.dispose();

    const afterDispose = dispatchMouse(xtermTarget, "mousedown", 1);
    expect(xtermMouseDown).toHaveBeenCalledOnce();
    expect(afterDispose.defaultPrevented).toBe(false);
  });

  it("keeps non-Windows middle mousedown and Windows primary mousedown visible to xterm", () => {
    const nonWindows = createHarness({ isWindows: false });
    const nonWindowsMouseDown = vi.fn();
    nonWindows.xtermTarget.addEventListener("mousedown", nonWindowsMouseDown);

    dispatchMouse(nonWindows.xtermTarget, "mousedown", 1);

    expect(nonWindowsMouseDown).toHaveBeenCalledOnce();
    nonWindows.controller.dispose();

    const windows = createHarness();
    const windowsMouseDown = vi.fn();
    windows.xtermTarget.addEventListener("mousedown", windowsMouseDown);

    dispatchMouse(windows.xtermTarget, "mousedown", 0);

    expect(windowsMouseDown).toHaveBeenCalledOnce();
    windows.controller.dispose();
  });

  it("keeps middle-click terminal selection paste behavior", () => {
    const { controller, pasteClipboard, pasteText, terminal, xtermTarget } = createHarness();
    vi.mocked(terminal.getSelection).mockReturnValue("selected text");

    dispatchMouse(xtermTarget, "mousedown", 1);
    dispatchMouse(xtermTarget, "mouseup", 1);

    expect(pasteText).toHaveBeenCalledOnce();
    expect(pasteText).toHaveBeenCalledWith("selected text");
    expect(pasteClipboard).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("handles synthetic Win+V only when the terminal had focus before blur", () => {
    const first = createHarness();
    first.textarea.focus();
    window.dispatchEvent(new Event("blur"));

    const syntheticEvent = dispatchSyntheticWinVPaste();

    expect(first.pasteClipboard).toHaveBeenCalledOnce();
    expect(syntheticEvent.defaultPrevented).toBe(true);
    first.controller.dispose();

    const second = createHarness();
    second.otherControl.focus();
    window.dispatchEvent(new Event("blur"));

    const ignoredEvent = dispatchSyntheticWinVPaste();

    expect(second.pasteClipboard).not.toHaveBeenCalled();
    expect(ignoredEvent.defaultPrevented).toBe(false);
    second.controller.dispose();
  });

  it("does not install the workaround on non-Windows platforms", () => {
    const { controller, pasteClipboard, textarea } = createHarness({
      isWindows: false,
    });
    textarea.focus();
    window.dispatchEvent(new Event("blur"));

    const event = dispatchSyntheticWinVPaste();

    expect(pasteClipboard).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    controller.dispose();
  });

  it("handles Win+V when focus is tracked without a window blur event", () => {
    const { controller, pasteClipboard, textarea } = createHarness();
    textarea.focus();

    const event = dispatchSyntheticWinVPaste();

    expect(pasteClipboard).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    controller.dispose();
  });

  it("leaves physical Ctrl+V for xterm instead of treating it as paste", () => {
    const { controller, pasteClipboard, textarea } = createHarness();
    textarea.focus();
    window.dispatchEvent(new Event("blur"));

    const event = dispatchPhysicalCtrlV();

    expect(pasteClipboard).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    controller.dispose();
  });

  it("does not capture ordinary paste events or force focus onto the terminal", () => {
    const { controller, otherControl, pasteClipboard, terminal } =
      createHarness();
    otherControl.focus();

    const pasteEvent = new Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(pasteEvent);
    window.dispatchEvent(new Event("focus"));

    expect(pasteClipboard).not.toHaveBeenCalled();
    expect(terminal.focus).not.toHaveBeenCalled();
    controller.dispose();
  });
});
