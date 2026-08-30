import { mapKeyboardCodeToRdp, type RdpInputEvent } from "@/lib/rdpInput";
import { parseHotkeyString } from "@/lib/shortcutRegistry";
import type { RdpSpecialShortcutConfig } from "@/types/global";

export interface RdpSpecialShortcut {
  id: string;
  label: string;
  labelKey?: string;
  combo: string;
  builtin?: boolean;
  events: RdpInputEvent[];
}

const MODIFIER_BINDINGS = {
  ctrl: { code: "ControlLeft", scanCode: 0x1d, extended: false },
  alt: { code: "AltLeft", scanCode: 0x38, extended: false },
  shift: { code: "ShiftLeft", scanCode: 0x2a, extended: false },
  meta: { code: "MetaLeft", scanCode: 0x5b, extended: true },
} as const;

function keyEvent(
  scanCode: number,
  extended: boolean,
  type: "key-down" | "key-up",
): RdpInputEvent {
  return { type, scanCode, extended, repeat: false };
}

function keyEventFromCode(code: string, type: "key-down" | "key-up"): RdpInputEvent | null {
  const mapping = mapKeyboardCodeToRdp(code);
  if (!mapping) return null;
  return keyEvent(mapping.scanCode, mapping.extended ?? false, type);
}

function resolveMainKeyCode(keyPart: string): string | null {
  const normalized = keyPart.trim().toLowerCase();
  if (!normalized) return null;
  if (/^f\d+$/.test(normalized)) {
    return normalized.toUpperCase();
  }
  const letterMatch = normalized.match(/^[a-z]$/);
  if (letterMatch) {
    return `Key${letterMatch[0].toUpperCase()}`;
  }
  const digitMatch = normalized.match(/^\d$/);
  if (digitMatch) {
    return `Digit${digitMatch[0]}`;
  }

  const named: Record<string, string> = {
    tab: "Tab",
    escape: "Escape",
    esc: "Escape",
    space: "Space",
    enter: "Enter",
    backspace: "Backspace",
    delete: "Delete",
    insert: "Insert",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    arrowup: "ArrowUp",
    arrowdown: "ArrowDown",
    arrowleft: "ArrowLeft",
    arrowright: "ArrowRight",
  };
  return named[normalized] ?? null;
}

export function hotkeyComboToRdpEvents(combo: string): RdpInputEvent[] {
  const parsed = parseHotkeyString(combo)[0];
  if (!parsed) return [];

  const downs: RdpInputEvent[] = [];
  const modifierUps: RdpInputEvent[] = [];

  const pushModifier = (enabled: boolean, binding: (typeof MODIFIER_BINDINGS)[keyof typeof MODIFIER_BINDINGS]) => {
    if (!enabled) return;
    downs.push(keyEvent(binding.scanCode, binding.extended, "key-down"));
    modifierUps.push(keyEvent(binding.scanCode, binding.extended, "key-up"));
  };

  pushModifier(parsed.ctrl, MODIFIER_BINDINGS.ctrl);
  pushModifier(parsed.shift, MODIFIER_BINDINGS.shift);
  pushModifier(parsed.alt, MODIFIER_BINDINGS.alt);
  pushModifier(parsed.meta, MODIFIER_BINDINGS.meta);

  const mainCode = parsed.code || resolveMainKeyCode(combo.split("+").at(-1) ?? "");
  const ups: RdpInputEvent[] = [];
  if (mainCode) {
    const down = keyEventFromCode(mainCode, "key-down");
    const up = keyEventFromCode(mainCode, "key-up");
    if (down && up) {
      downs.push(down);
      ups.push(up);
    }
  }

  return [...downs, ...ups, ...modifierUps.reverse()];
}

function builtinShortcut(
  id: string,
  labelKey: string,
  combo: string,
): RdpSpecialShortcut {
  return {
    id,
    label: labelKey,
    labelKey,
    combo,
    builtin: true,
    events: hotkeyComboToRdpEvents(combo),
  };
}

export const DEFAULT_RDP_SPECIAL_SHORTCUTS: RdpSpecialShortcut[] = [
  builtinShortcut("builtin.ctrl-alt-del", "remoteDesktop.shortcuts.ctrlAltDel", "ctrl+alt+delete"),
  builtinShortcut("builtin.win-r", "remoteDesktop.shortcuts.winR", "meta+r"),
  builtinShortcut("builtin.win-d", "remoteDesktop.shortcuts.winD", "meta+d"),
  builtinShortcut("builtin.win-l", "remoteDesktop.shortcuts.winL", "meta+l"),
  builtinShortcut("builtin.win-e", "remoteDesktop.shortcuts.winE", "meta+e"),
  builtinShortcut(
    "builtin.ctrl-shift-esc",
    "remoteDesktop.shortcuts.ctrlShiftEsc",
    "ctrl+shift+escape",
  ),
  builtinShortcut(
    "builtin.ctrl-win-left",
    "remoteDesktop.shortcuts.ctrlWinLeft",
    "ctrl+meta+arrowleft",
  ),
  builtinShortcut(
    "builtin.ctrl-win-right",
    "remoteDesktop.shortcuts.ctrlWinRight",
    "ctrl+meta+arrowright",
  ),
  builtinShortcut("builtin.alt-f4", "remoteDesktop.shortcuts.altF4", "alt+f4"),
  builtinShortcut("builtin.win-tab", "remoteDesktop.shortcuts.winTab", "meta+tab"),
];

export function customShortcutFromConfig(config: RdpSpecialShortcutConfig): RdpSpecialShortcut {
  return {
    id: config.id,
    label: config.label,
    combo: config.combo,
    builtin: false,
    events: hotkeyComboToRdpEvents(config.combo),
  };
}

export function resolveRdpSpecialShortcuts(
  customShortcuts: RdpSpecialShortcutConfig[] = [],
): RdpSpecialShortcut[] {
  const custom = customShortcuts.map(customShortcutFromConfig);
  return [...DEFAULT_RDP_SPECIAL_SHORTCUTS, ...custom];
}

export function shortcutConfigFromCustom(shortcut: RdpSpecialShortcut): RdpSpecialShortcutConfig {
  return {
    id: shortcut.id,
    label: shortcut.label,
    combo: shortcut.combo,
  };
}

export function isBuiltinRdpShortcut(id: string): boolean {
  return id.startsWith("builtin.");
}
