import { describe, expect, it } from "vitest";
import {
  decideFitWindowResize,
  keepDesktopSizeIfUnchanged,
  normalizeRdpDisplayMode,
  shouldDisableDynamicResizeAfterState,
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

  it("allows the first active fit-window resize", () => {
    expect(
      decideFitWindowResize({
        mode: "fit-window",
        visible: true,
        containerWidth: 1200,
        containerHeight: 800,
        allowInitialResize: true,
      }),
    ).toEqual({ shouldResize: true, width: 1200, height: 800 });
  });

  it("skips initial resize when the remote size already matches the container closely", () => {
    expect(
      decideFitWindowResize({
        mode: "fit-window",
        visible: true,
        containerWidth: 1210,
        containerHeight: 805,
        remoteWidth: 1200,
        remoteHeight: 800,
        allowInitialResize: true,
        minDelta: 32,
      }).shouldResize,
    ).toBe(false);

    expect(
      decideFitWindowResize({
        mode: "fit-window",
        visible: true,
        containerWidth: 1280,
        containerHeight: 900,
        remoteWidth: 1200,
        remoteHeight: 800,
        allowInitialResize: true,
        minDelta: 32,
      }).shouldResize,
    ).toBe(true);
  });

  it("does not resize when dynamic resize has been disabled", () => {
    expect(
      decideFitWindowResize({
        mode: "fit-window",
        visible: true,
        containerWidth: 1280,
        containerHeight: 900,
        disabled: true,
      }).shouldResize,
    ).toBe(false);
  });

  it("can suppress the first fit-window resize when callers need priming", () => {
    expect(
      decideFitWindowResize({
        mode: "fit-window",
        visible: true,
        containerWidth: 1200,
        containerHeight: 800,
        allowInitialResize: false,
      }),
    ).toEqual({ shouldResize: false, width: 1200, height: 800 });
  });

  it("keeps desktop object identity when the size is unchanged", () => {
    const current = { width: 1920, height: 1080 };
    expect(keepDesktopSizeIfUnchanged(current, { width: 1920, height: 1080 })).toBe(current);
    expect(keepDesktopSizeIfUnchanged(current, { width: 1280, height: 720 })).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("disables dynamic resize when reconnecting or failed shortly after resize", () => {
    expect(
      shouldDisableDynamicResizeAfterState({
        state: "reconnecting",
        lastResizeAt: 1000,
        now: 2500,
      }),
    ).toBe(true);
    expect(
      shouldDisableDynamicResizeAfterState({
        state: "failed",
        lastResizeAt: 1000,
        now: 4500,
      }),
    ).toBe(false);
    expect(
      shouldDisableDynamicResizeAfterState({
        state: "active",
        lastResizeAt: 1000,
        now: 1500,
      }),
    ).toBe(false);
  });
});
