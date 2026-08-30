import { describe, expect, it } from "vitest";
import {
  DEFAULT_RDP_SPECIAL_SHORTCUTS,
  hotkeyComboToRdpEvents,
  resolveRdpSpecialShortcuts,
} from "@/lib/rdpSpecialShortcuts";

describe("rdpSpecialShortcuts", () => {
  it("builds ctrl+alt+delete chord events", () => {
    const events = hotkeyComboToRdpEvents("ctrl+alt+delete");
    expect(events).toEqual([
      { type: "key-down", scanCode: 0x1d, extended: false, repeat: false },
      { type: "key-down", scanCode: 0x38, extended: false, repeat: false },
      { type: "key-down", scanCode: 0x53, extended: true, repeat: false },
      { type: "key-up", scanCode: 0x53, extended: true, repeat: false },
      { type: "key-up", scanCode: 0x38, extended: false, repeat: false },
      { type: "key-up", scanCode: 0x1d, extended: false, repeat: false },
    ]);
  });

  it("builds win+r chord events", () => {
    const events = hotkeyComboToRdpEvents("meta+r");
    expect(events).toEqual([
      { type: "key-down", scanCode: 0x5b, extended: true, repeat: false },
      { type: "key-down", scanCode: 0x13, extended: false, repeat: false },
      { type: "key-up", scanCode: 0x13, extended: false, repeat: false },
      { type: "key-up", scanCode: 0x5b, extended: true, repeat: false },
    ]);
  });

  it("merges builtin shortcuts with custom shortcuts", () => {
    const shortcuts = resolveRdpSpecialShortcuts([
      { id: "custom-1", label: "Custom", combo: "meta+d" },
    ]);
    expect(shortcuts).toHaveLength(DEFAULT_RDP_SPECIAL_SHORTCUTS.length + 1);
    expect(shortcuts.at(-1)?.label).toBe("Custom");
    expect(shortcuts.at(-1)?.builtin).toBe(false);
  });
});
