import { describe, expect, it } from "vitest";
import {
  createRemoteDesktopFramePatchBuffer,
  decodeRemoteDesktopFramePatch,
} from "./remoteDesktopFrame";

function frame(overrides: Partial<Parameters<typeof createRemoteDesktopFramePatchBuffer>[0]> = {}) {
  return createRemoteDesktopFramePatchBuffer({
    sequence: 1n,
    desktopWidth: 10,
    desktopHeight: 10,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    stride: 4,
    pixelFormat: "RGBA8888",
    payload: new Uint8Array([0, 0, 0, 255]),
    ...overrides,
  });
}

describe("remoteDesktopFrame", () => {
  it("preserves the existing 44-byte patch contract", () => {
    const patch = decodeRemoteDesktopFramePatch(
      frame({ sequence: 42n, desktopWidth: 1920, desktopHeight: 1080, x: 9, y: 7 }),
    );

    expect(patch).toMatchObject({
      sequence: 42n,
      desktopWidth: 1920,
      desktopHeight: 1080,
      x: 9,
      y: 7,
      width: 1,
      height: 1,
      stride: 4,
      pixelFormat: "RGBA8888",
    });
  });

  it("rejects rectangles outside the declared desktop", () => {
    expect(() => decodeRemoteDesktopFramePatch(frame({ x: 10 }))).toThrow(/desktop bounds/);
    expect(() => decodeRemoteDesktopFramePatch(frame({ y: 10 }))).toThrow(/desktop bounds/);
  });

  it("rejects empty desktop and rectangle dimensions", () => {
    expect(() => decodeRemoteDesktopFramePatch(frame({ desktopWidth: 0 }))).toThrow(/desktop size/);
    expect(() => decodeRemoteDesktopFramePatch(frame({ width: 0, stride: 0 }))).toThrow(
      /rectangle/,
    );
  });
});
