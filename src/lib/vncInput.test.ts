import { describe, expect, it } from "vitest";
import {
  buildVncCompositionKeyEvents,
  mapKeyboardEventToVncKeysym,
  pointerButtonMask,
  unicodeCodePointToVncKeysym,
} from "./vncInput";

function key(key: string, code = key) {
  return { key, code } as KeyboardEvent;
}

describe("vncInput", () => {
  it("maps navigation, function, and modifier keys to X11 keysyms", () => {
    expect(mapKeyboardEventToVncKeysym(key("ArrowLeft"))).toBe(0xff51);
    expect(mapKeyboardEventToVncKeysym(key("F12"))).toBe(0xffc9);
    expect(mapKeyboardEventToVncKeysym(key("Shift", "ShiftRight"))).toBe(0xffe2);
    expect(mapKeyboardEventToVncKeysym(key("Meta", "MetaLeft"))).toBe(0xffeb);
  });

  it("uses Latin-1 values directly and Unicode keysyms for other characters", () => {
    expect(unicodeCodePointToVncKeysym("A".codePointAt(0) ?? 0)).toBe(0x41);
    expect(unicodeCodePointToVncKeysym("é".codePointAt(0) ?? 0)).toBe(0xe9);
    expect(unicodeCodePointToVncKeysym("你".codePointAt(0) ?? 0)).toBe(0x01004f60);
  });

  it("turns composition text into ordered key down/up pairs", () => {
    expect(buildVncCompositionKeyEvents("A你")).toEqual([
      { type: "key", keysym: 0x41, pressed: true },
      { type: "key", keysym: 0x41, pressed: false },
      { type: "key", keysym: 0x01004f60, pressed: true },
      { type: "key", keysym: 0x01004f60, pressed: false },
    ]);
  });

  it("builds the RFB pointer mask from pressed browser buttons", () => {
    expect(pointerButtonMask(new Set([0, 2]))).toBe(5);
    expect(pointerButtonMask(new Set([1]))).toBe(2);
  });
});
