import { describe, expect, it } from "vitest";
import {
  getRemoteDesktopContentRect,
  mapClientEventToRemoteDesktopPixel,
} from "./remoteDesktopViewport";

function canvas(
  desktopWidth: number,
  desktopHeight: number,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
) {
  const element = document.createElement("canvas");
  element.width = desktopWidth;
  element.height = desktopHeight;
  element.getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  return element;
}

describe("remoteDesktopViewport", () => {
  it("uses an aspect-preserving content rect for fit mode", () => {
    const element = canvas(100, 100, { left: 10, top: 20, width: 300, height: 200 });
    expect(getRemoteDesktopContentRect(element, "fit")).toMatchObject({
      left: 60,
      top: 20,
      width: 200,
      height: 200,
    });
  });

  it("uses the full canvas rect for actual and stretch modes", () => {
    const element = canvas(100, 100, { left: 10, top: 20, width: 300, height: 200 });
    expect(getRemoteDesktopContentRect(element, "actual")).toMatchObject({
      left: 10,
      top: 20,
      width: 300,
      height: 200,
    });
    expect(getRemoteDesktopContentRect(element, "stretch")).toMatchObject({
      left: 10,
      top: 20,
      width: 300,
      height: 200,
    });
  });

  it("maps stretch coordinates across the full stretched canvas", () => {
    const element = canvas(100, 100, { left: 10, top: 20, width: 300, height: 200 });
    expect(
      mapClientEventToRemoteDesktopPixel(element, { clientX: 160, clientY: 120 }, "stretch"),
    ).toEqual({ x: 50, y: 50 });
  });

  it("maps fit coordinates through the centered content rect", () => {
    const element = canvas(100, 100, { left: 10, top: 20, width: 300, height: 200 });
    expect(
      mapClientEventToRemoteDesktopPixel(element, { clientX: 60, clientY: 20 }, "fit"),
    ).toEqual({ x: 0, y: 0 });
    expect(
      mapClientEventToRemoteDesktopPixel(element, { clientX: 260, clientY: 220 }, "fit"),
    ).toEqual({ x: 99, y: 99 });
  });
});
