import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import type { TerminalAppSettings } from "@/context/AppContext";
import { createTerminalInputState } from "@/lib/terminalInputTracker";
import type { SessionType } from "@/types/global";
import type { XTerminalImeKeyboardRoute } from "./xterminalIme";
import { installXTerminalKeyboardController } from "./xterminalKeyboardController";

function backspaceEvent(keyCode: number, isComposing = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Backspace",
    code: "Backspace",
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(event, {
    isComposing: { value: isComposing },
    keyCode: { value: keyCode },
  });
  return event;
}

function createHarness(imeRoute: XTerminalImeKeyboardRoute, sessionType: SessionType = "Local") {
  const keyHandlerRef: {
    current: ((event: KeyboardEvent) => boolean) | null;
  } = { current: null };
  const terminal = {
    attachCustomKeyEventHandler: vi.fn((handler: (event: KeyboardEvent) => boolean) => {
      keyHandlerRef.current = handler;
    }),
    getSelection: vi.fn(() => ""),
    hasSelection: vi.fn(() => false),
  } as unknown as Terminal;
  const routeKeyboardEvent = vi.fn(() => imeRoute);
  const sendRawInput = vi.fn(async () => {});
  const syncSuggestionsWithInputState = vi.fn();
  const inputStateRef = {
    current: {
      ...createTerminalInputState(),
      value: "a",
      cursor: 1,
    },
  };

  installXTerminalKeyboardController({
    terminal,
    imeTracker: { routeKeyboardEvent },
    terminalAppSettingsRef: {
      current: { keybindings: {} } as TerminalAppSettings,
    },
    sessionTypeRef: { current: sessionType },
    inputStateRef,
    disconnectedRef: { current: false },
    onDisconnectedCloseRequestedRef: { current: undefined },
    showSuggestionsRef: { current: false },
    suggestionsRef: { current: [] },
    doFindRef: { current: vi.fn() },
    pasteClipboard: vi.fn(async () => {}),
    pasteText: vi.fn(),
    sendRawInput,
    triggerSearch: vi.fn(),
    dismissSuggestions: vi.fn(),
    moveCredentialSelection: vi.fn(() => false),
    isCredentialPanelActive: vi.fn(() => false),
    moveCommandSuggestionSelection: vi.fn(() => false),
    acceptCommandSuggestion: vi.fn(() => false),
    isCredentialPromptInputMode: vi.fn(() => false),
    clearSearchSelectionBeforeInput: vi.fn(() => false),
    getSmartCursorSelectedInputRange: vi.fn(() => null),
    deleteInputSelection: vi.fn(),
    collapseInputSelection: vi.fn(),
    replaceInputSelection: vi.fn(),
    syncSuggestionsWithInputState,
    lastSelectionRef: { current: "" },
  });

  const keyHandler = keyHandlerRef.current;
  if (!keyHandler) {
    throw new Error("keyboard handler was not installed");
  }

  return {
    inputStateRef,
    keyHandler,
    routeKeyboardEvent,
    sendRawInput,
    syncSuggestionsWithInputState,
  };
}

describe("installXTerminalKeyboardController IME Backspace routing", () => {
  it("leaves IME Backspace native without preventing default", () => {
    const harness = createHarness("native-ime");
    const event = backspaceEvent(229, true);

    expect(harness.keyHandler(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(harness.sendRawInput).not.toHaveBeenCalled();
    expect(harness.syncSuggestionsWithInputState).not.toHaveBeenCalled();
    expect(harness.inputStateRef.current.value).toBe("a");
  });

  it("delegates idle keyCode 229 Backspace to xterm", () => {
    const harness = createHarness("xterm");
    const event = backspaceEvent(229);

    expect(harness.keyHandler(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(harness.sendRawInput).not.toHaveBeenCalled();
    expect(harness.inputStateRef.current.value).toBe("a");
  });

  it("preserves the existing non-IME Local Backspace behavior", () => {
    const harness = createHarness("application");
    const event = backspaceEvent(8);

    expect(harness.keyHandler(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(harness.sendRawInput).toHaveBeenCalledOnce();
    expect(harness.sendRawInput).toHaveBeenCalledWith("\x7f", null);
    expect(harness.syncSuggestionsWithInputState).toHaveBeenCalledOnce();
    expect(harness.inputStateRef.current.value).toBe("");
    expect(harness.inputStateRef.current.cursor).toBe(0);
  });

  it("does not apply the IME guard outside Local Backspace handling", () => {
    const harness = createHarness("native-ime", "SSH");
    const event = backspaceEvent(8, true);

    expect(harness.keyHandler(event)).toBe(true);
    expect(harness.routeKeyboardEvent).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
