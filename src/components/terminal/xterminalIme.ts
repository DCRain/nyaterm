export type XTerminalImePhase = "idle" | "composing" | "ending";

export type XTerminalImeKeyboardRoute = "application" | "xterm" | "native-ime";

export interface XTerminalImeKeyboardEventLike {
  keyCode?: number;
  isComposing?: boolean;
}

export interface XTerminalImeTracker {
  readonly phase: XTerminalImePhase;
  routeKeyboardEvent(event: KeyboardEvent): XTerminalImeKeyboardRoute;
  dispose(): void;
}

// keyCode is deprecated, but 229 remains necessary for WebKit and legacy IMEs
// whose boundary keydown can arrive after compositionend with isComposing=false.
const IME_PROCESS_KEY_CODE = 229;

function isCompositionInputType(inputType: string | undefined): boolean {
  return inputType?.includes("Composition") === true;
}

/**
 * Chooses whether an event belongs to the native IME, xterm's legacy fallback,
 * or normal application keyboard handling. Callers decide which keys need this
 * ownership boundary.
 */
export function resolveXTerminalImeKeyboardRoute(
  event: XTerminalImeKeyboardEventLike,
  phase: XTerminalImePhase,
): XTerminalImeKeyboardRoute {
  if (phase !== "idle" || event.isComposing === true) {
    return "native-ime";
  }
  if (event.keyCode === IME_PROCESS_KEY_CODE) {
    return "xterm";
  }
  return "application";
}

export function createXTerminalImeTracker(
  textarea: HTMLTextAreaElement | undefined,
): XTerminalImeTracker {
  let phase: XTerminalImePhase = "idle";
  let endingTimer: ReturnType<typeof setTimeout> | null = null;

  const clearEndingTimer = () => {
    if (endingTimer !== null) {
      clearTimeout(endingTimer);
      endingTimer = null;
    }
  };

  const markComposing = () => {
    clearEndingTimer();
    phase = "composing";
  };

  const markEnding = () => {
    clearEndingTimer();
    phase = "ending";
    endingTimer = setTimeout(() => {
      endingTimer = null;
      phase = "idle";
    }, 0);
  };

  const reset = () => {
    clearEndingTimer();
    phase = "idle";
  };

  const handleCompositionStart = () => {
    markComposing();
  };

  const handleCompositionUpdate = () => {
    markComposing();
  };

  const handleCompositionEnd = () => {
    markEnding();
  };

  const handleInput = (rawEvent: Event) => {
    const event = rawEvent as InputEvent;
    if (event.isComposing) {
      markComposing();
      return;
    }

    // Some engines omit compositionstart/end or finish composition with a
    // plain committed input. These are semantic composition boundaries.
    if (phase === "composing" || isCompositionInputType(event.inputType)) {
      markEnding();
    }
  };

  if (textarea) {
    textarea.addEventListener("compositionstart", handleCompositionStart, true);
    textarea.addEventListener("compositionupdate", handleCompositionUpdate, true);
    textarea.addEventListener("compositionend", handleCompositionEnd, true);
    textarea.addEventListener("blur", reset, true);
    textarea.addEventListener("beforeinput", handleInput, true);
    textarea.addEventListener("input", handleInput, true);
  }

  return {
    get phase() {
      return phase;
    },
    routeKeyboardEvent(event: KeyboardEvent): XTerminalImeKeyboardRoute {
      return resolveXTerminalImeKeyboardRoute(event, phase);
    },
    dispose() {
      reset();
      if (textarea) {
        textarea.removeEventListener("compositionstart", handleCompositionStart, true);
        textarea.removeEventListener("compositionupdate", handleCompositionUpdate, true);
        textarea.removeEventListener("compositionend", handleCompositionEnd, true);
        textarea.removeEventListener("blur", reset, true);
        textarea.removeEventListener("beforeinput", handleInput, true);
        textarea.removeEventListener("input", handleInput, true);
      }
    },
  };
}
