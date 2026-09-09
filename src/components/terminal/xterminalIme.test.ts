import { afterEach, describe, expect, it, vi } from "vitest";
import { createXTerminalImeTracker, resolveXTerminalImeKeyboardRoute } from "./xterminalIme";

function keyboardEvent(keyCode: number, isComposing = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "a",
    code: "KeyA",
  });
  Object.defineProperties(event, {
    isComposing: { value: isComposing },
    keyCode: { value: keyCode },
  });
  return event;
}

describe("xterm IME ownership tracking", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes active, legacy, and ordinary keyboard events", () => {
    expect(resolveXTerminalImeKeyboardRoute({ keyCode: 65, isComposing: true }, "idle")).toBe(
      "native-ime",
    );
    expect(resolveXTerminalImeKeyboardRoute({ keyCode: 65 }, "composing")).toBe("native-ime");
    expect(resolveXTerminalImeKeyboardRoute({ keyCode: 65 }, "ending")).toBe("native-ime");
    expect(resolveXTerminalImeKeyboardRoute({ keyCode: 229 }, "idle")).toBe("xterm");
    expect(resolveXTerminalImeKeyboardRoute({ keyCode: 65 }, "idle")).toBe("application");
  });

  it("keeps an ending boundary until the next task", async () => {
    vi.useFakeTimers();
    const textarea = document.createElement("textarea");
    const tracker = createXTerminalImeTracker(textarea);

    textarea.dispatchEvent(new CompositionEvent("compositionstart"));
    expect(tracker.phase).toBe("composing");

    textarea.dispatchEvent(new CompositionEvent("compositionend"));
    expect(tracker.phase).toBe("ending");
    expect(tracker.routeKeyboardEvent(keyboardEvent(229))).toBe("native-ime");

    await vi.runAllTimersAsync();
    expect(tracker.phase).toBe("idle");
    expect(tracker.routeKeyboardEvent(keyboardEvent(65))).toBe("application");

    tracker.dispose();
  });

  it("tracks composition input when lifecycle events are missing", async () => {
    vi.useFakeTimers();
    const textarea = document.createElement("textarea");
    const tracker = createXTerminalImeTracker(textarea);

    textarea.dispatchEvent(
      new InputEvent("beforeinput", {
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    );
    expect(tracker.phase).toBe("composing");

    textarea.dispatchEvent(
      new InputEvent("input", {
        inputType: "insertFromComposition",
        isComposing: false,
      }),
    );
    expect(tracker.phase).toBe("ending");

    await vi.runAllTimersAsync();
    expect(tracker.phase).toBe("idle");

    tracker.dispose();
  });

  it("recognizes a non-composing composition input as a boundary", async () => {
    vi.useFakeTimers();
    const textarea = document.createElement("textarea");
    const tracker = createXTerminalImeTracker(textarea);

    textarea.dispatchEvent(
      new InputEvent("input", {
        inputType: "deleteCompositionText",
        isComposing: false,
      }),
    );
    expect(tracker.phase).toBe("ending");

    await vi.runAllTimersAsync();
    expect(tracker.phase).toBe("idle");

    tracker.dispose();
  });

  it("uses ordinary committed input as a missing compositionend fallback", async () => {
    vi.useFakeTimers();
    const textarea = document.createElement("textarea");
    const tracker = createXTerminalImeTracker(textarea);

    textarea.dispatchEvent(new CompositionEvent("compositionstart"));
    textarea.dispatchEvent(
      new InputEvent("input", {
        inputType: "insertText",
        isComposing: false,
      }),
    );
    expect(tracker.phase).toBe("ending");

    await vi.runAllTimersAsync();
    expect(tracker.phase).toBe("idle");

    tracker.dispose();
  });

  it("does not expire a valid paused composition and resets on blur", () => {
    vi.useFakeTimers();
    const textarea = document.createElement("textarea");
    const tracker = createXTerminalImeTracker(textarea);

    textarea.dispatchEvent(new CompositionEvent("compositionstart"));
    vi.advanceTimersByTime(60_000);
    expect(tracker.phase).toBe("composing");

    textarea.dispatchEvent(new FocusEvent("blur"));
    expect(tracker.phase).toBe("idle");

    tracker.dispose();
  });

  it("removes listeners and resets phase and timer on dispose", async () => {
    vi.useFakeTimers();
    const textarea = document.createElement("textarea");
    const tracker = createXTerminalImeTracker(textarea);

    textarea.dispatchEvent(new CompositionEvent("compositionstart"));
    textarea.dispatchEvent(new CompositionEvent("compositionend"));
    tracker.dispose();

    expect(tracker.phase).toBe("idle");
    textarea.dispatchEvent(new CompositionEvent("compositionstart"));
    expect(tracker.phase).toBe("idle");
    await vi.runAllTimersAsync();
    expect(tracker.phase).toBe("idle");
  });
});
