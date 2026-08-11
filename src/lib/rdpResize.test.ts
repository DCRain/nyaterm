import { describe, expect, it } from "vitest";
import {
  decideFitWindowResize,
  keepDesktopSizeIfUnchanged,
  normalizeRdpDisplayMode,
} from "./rdpResize";

describe("rdpResize", () => {
  it("normalizes unsupported display modes to fixed", () => {
    expect(normalizeRdpDisplayMode("fit-window")).toBe("fit-window");
    expect(normalizeRdpDisplayMode("native")).toBe("fixed");
    expect(normalizeRdpDisplayMode("fixed")).toBe("fixed");
  });

  it("does not resize fixed or invisible sessions", () => {
    expect(
      decideFitWindowResize({
        mode: "fixed",
        visible: true,
        containerWidth: 1200,
        containerHeight: 800,
      }).shouldResize,
    ).toBe(false);
    expect(
      decideFitWindowResize({
        mode: "fit-window",
        visible: false,
        containerWidth: 1200,
        containerHeight: 800,
      }).shouldResize,
    ).toBe(false);
  });

  it("matches container size with even width and skips duplicates", () => {
    expect(
      decideFitWindowResize({
        mode: "fit-window",
        visible: true,
        containerWidth: 321.7,
        containerHeight: 200.9,
      }),
    ).toEqual({ shouldResize: true, width: 320, height: 200 });

    expect(
      decideFitWindowResize({
        mode: "fit-window",
        visible: true,
        containerWidth: 1600,
        containerHeight: 900,
        lastWidth: 1600,
        lastHeight: 900,
      }).shouldResize,
    ).toBe(false);
  });

  it("clamps tiny containers up to protocol minimum", () => {
    expect(
      decideFitWindowResize({
        mode: "fit-window",
        visible: true,
        containerWidth: 120,
        containerHeight: 80,
      }),
    ).toEqual({ shouldResize: true, width: 200, height: 200 });
  });

  it("keeps desktop object identity when the size is unchanged", () => {
    const current = { width: 1920, height: 1080 };
    expect(keepDesktopSizeIfUnchanged(current, { width: 1920, height: 1080 })).toBe(current);
    expect(keepDesktopSizeIfUnchanged(current, { width: 1280, height: 720 })).toEqual({
      width: 1280,
      height: 720,
    });
  });
});
