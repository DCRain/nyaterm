export type VncInputEvent =
  | { type: "key"; keysym: number; pressed: boolean }
  | { type: "pointer"; x: number; y: number; buttonMask: number }
  | { type: "release-all-keys" };

const XK = {
  BackSpace: 0xff08,
  Tab: 0xff09,
  Return: 0xff0d,
  Escape: 0xff1b,
  Home: 0xff50,
  Left: 0xff51,
  Up: 0xff52,
  Right: 0xff53,
  Down: 0xff54,
  PageUp: 0xff55,
  PageDown: 0xff56,
  End: 0xff57,
  Insert: 0xff63,
  Menu: 0xff67,
  NumLock: 0xff7f,
  Delete: 0xffff,
  ShiftLeft: 0xffe1,
  ShiftRight: 0xffe2,
  ControlLeft: 0xffe3,
  ControlRight: 0xffe4,
  CapsLock: 0xffe5,
  MetaLeft: 0xffe7,
  MetaRight: 0xffe8,
  AltLeft: 0xffe9,
  AltRight: 0xffea,
  SuperLeft: 0xffeb,
  SuperRight: 0xffec,
  ScrollLock: 0xff14,
  F1: 0xffbe,
} as const;

const SPECIAL_KEYSYMS: Readonly<Record<string, number>> = {
  Backspace: XK.BackSpace,
  Tab: XK.Tab,
  Enter: XK.Return,
  Escape: XK.Escape,
  Home: XK.Home,
  ArrowLeft: XK.Left,
  ArrowUp: XK.Up,
  ArrowRight: XK.Right,
  ArrowDown: XK.Down,
  PageUp: XK.PageUp,
  PageDown: XK.PageDown,
  End: XK.End,
  Insert: XK.Insert,
  ContextMenu: XK.Menu,
  NumLock: XK.NumLock,
  Delete: XK.Delete,
  CapsLock: XK.CapsLock,
  ScrollLock: XK.ScrollLock,
};

const CODE_KEYSYMS: Readonly<Record<string, number>> = {
  ShiftLeft: XK.ShiftLeft,
  ShiftRight: XK.ShiftRight,
  ControlLeft: XK.ControlLeft,
  ControlRight: XK.ControlRight,
  AltLeft: XK.AltLeft,
  AltRight: XK.AltRight,
  MetaLeft: XK.SuperLeft,
  MetaRight: XK.SuperRight,
};

export const VNC_POINTER_BUTTON = {
  left: 1,
  middle: 2,
  right: 4,
  wheelUp: 8,
  wheelDown: 16,
  wheelLeft: 32,
  wheelRight: 64,
} as const;

export function unicodeCodePointToVncKeysym(codePoint: number): number | null {
  if (!Number.isInteger(codePoint) || codePoint < 0x20 || codePoint > 0x10ffff) return null;
  if (codePoint <= 0xff) return codePoint;
  return 0x01000000 | codePoint;
}

export function mapKeyboardEventToVncKeysym(
  event: Pick<KeyboardEvent, "key" | "code">,
): number | null {
  const codeKeysym = CODE_KEYSYMS[event.code];
  if (codeKeysym !== undefined) return codeKeysym;

  const specialKeysym = SPECIAL_KEYSYMS[event.key];
  if (specialKeysym !== undefined) return specialKeysym;

  if (/^F(?:[1-9]|1[0-2])$/.test(event.key)) {
    return XK.F1 + Number(event.key.slice(1)) - 1;
  }

  const codePoints = Array.from(event.key);
  if (codePoints.length !== 1) return null;
  return unicodeCodePointToVncKeysym(codePoints[0].codePointAt(0) ?? -1);
}

export function buildVncCompositionKeyEvents(text: string): VncInputEvent[] {
  const events: VncInputEvent[] = [];
  for (const character of Array.from(text)) {
    const keysym = unicodeCodePointToVncKeysym(character.codePointAt(0) ?? -1);
    if (keysym === null) continue;
    events.push({ type: "key", keysym, pressed: true });
    events.push({ type: "key", keysym, pressed: false });
  }
  return events;
}

export function pointerButtonMask(buttons: ReadonlySet<number>) {
  let mask = 0;
  for (const button of buttons) {
    if (button === 0) mask |= VNC_POINTER_BUTTON.left;
    if (button === 1) mask |= VNC_POINTER_BUTTON.middle;
    if (button === 2) mask |= VNC_POINTER_BUTTON.right;
  }
  return mask;
}
