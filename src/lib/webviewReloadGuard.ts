import { invoke } from "./invoke";

const TERMINAL_ROOT_SELECTOR = '[data-terminal-root="true"]';

let installed = false;

function isElement(value: EventTarget | null): value is Element {
  return value instanceof Element;
}

function eventPathContainsTerminalRoot(event: KeyboardEvent) {
  return event.composedPath().some((target) => {
    if (!isElement(target)) return false;
    return target.matches(TERMINAL_ROOT_SELECTOR);
  });
}

function eventTargetIsInsideTerminalRoot(event: KeyboardEvent) {
  if (eventPathContainsTerminalRoot(event)) return true;
  const target = event.target;
  return isElement(target) && target.closest(TERMINAL_ROOT_SELECTOR) !== null;
}

function isReloadShortcut(event: KeyboardEvent) {
  if (event.altKey) return false;
  if (event.code === "F5") return true;
  return (event.ctrlKey || event.metaKey) && event.code === "KeyR";
}

function isHardReloadShortcut(event: KeyboardEvent) {
  return (
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    !event.altKey &&
    event.code === "KeyR"
  );
}

function isPrintShortcut(event: KeyboardEvent) {
  if (event.code !== "KeyP" || event.altKey || event.shiftKey) return false;

  const isMac = navigator.userAgent.includes("Mac");
  if (isMac) return event.metaKey && !event.ctrlKey;
  return event.ctrlKey && !event.metaKey;
}

function isDevtoolsShortcut(event: KeyboardEvent) {
  if (event.code === "F12" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    return true;
  }
  // Ctrl/Cmd+Shift+I — common browser DevTools shortcut
  if (event.code !== "KeyI" || event.altKey || !event.shiftKey) return false;
  const isMac = navigator.userAgent.includes("Mac");
  if (isMac) return event.metaKey && !event.ctrlKey;
  return event.ctrlKey && !event.metaKey;
}

function isReservedWebviewShortcut(event: KeyboardEvent) {
  return isReloadShortcut(event) || isPrintShortcut(event);
}

function preventReservedWebviewShortcut(event: KeyboardEvent) {
  const insideTerminal = eventTargetIsInsideTerminalRoot(event);

  if (insideTerminal) {
    if (isHardReloadShortcut(event)) {
      event.preventDefault();
    }
    return;
  }

  if (isReservedWebviewShortcut(event)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function handleDevtoolsShortcut(event: KeyboardEvent) {
  if (!isDevtoolsShortcut(event)) return;

  event.preventDefault();
  event.stopPropagation();
  void invoke("open_devtools").catch(() => {});
}

export function installWebviewReloadGuard() {
  if (installed) return;
  installed = true;
  window.addEventListener("keydown", preventReservedWebviewShortcut, true);
  window.addEventListener("keydown", handleDevtoolsShortcut, true);
}
