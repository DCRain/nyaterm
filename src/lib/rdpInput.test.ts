import { describe, expect, it } from "vitest";
import { buildRdpKeyEvent, mapKeyboardCodeToRdp } from "./rdpInput";

describe("rdpInput", () => {
  it("maps left and right modifiers distinctly", () => {
    expect(mapKeyboardCodeToRdp("ShiftLeft")).toEqual({ scanCode: 0x2a });
    expect(mapKeyboardCodeToRdp("ShiftRight")).toEqual({ scanCode: 0x36 });
    expect(mapKeyboardCodeToRdp("ControlLeft")).toEqual({ scanCode: 0x1d });
    expect(mapKeyboardCodeToRdp("ControlRight")).toEqual({ scanCode: 0x1d, extended: true });
    expect(mapKeyboardCodeToRdp("AltRight")).toEqual({ scanCode: 0x38, extended: true });
  });

  it("sends right shift as a non-extended key event", () => {
    const event = new KeyboardEvent("keydown", { code: "ShiftRight" });

    expect(buildRdpKeyEvent(event, "key-down")).toEqual({
      type: "key-down",
      scanCode: 0x36,
      extended: false,
      repeat: false,
    });
  });

  it("uses key location when webview reports a generic shift code", () => {
    const event = new KeyboardEvent("keydown", {
      code: "Shift",
      key: "Shift",
      location: KeyboardEvent.DOM_KEY_LOCATION_RIGHT,
    });

    expect(buildRdpKeyEvent(event, "key-down")).toEqual({
      type: "key-down",
      scanCode: 0x36,
      extended: false,
      repeat: false,
    });
  });

  it("maps navigation keys as extended keys", () => {
    expect(mapKeyboardCodeToRdp("Delete")).toEqual({ scanCode: 0x53, extended: true });
    expect(mapKeyboardCodeToRdp("ArrowLeft")).toEqual({ scanCode: 0x4b, extended: true });
  });

  it("sends caps lock as a physical key event", () => {
    const event = new KeyboardEvent("keydown", { code: "CapsLock", key: "CapsLock" });

    expect(buildRdpKeyEvent(event, "key-down")).toEqual({
      type: "key-down",
      scanCode: 0x3a,
      extended: false,
      repeat: false,
    });
  });
});
