import { describe, expect, it } from "vitest";
import {
  alongEdgeCenter,
  centerOffsetForEdge,
  clampChromePosition,
  collapsedChromeSize,
  positionCenteredOnAlong,
  positionForEdge,
  SNAP_PADDING_PX,
  snapToNearestEdge,
} from "./floatingChromeLayout";

describe("floatingChromeLayout", () => {
  const bounds = { width: 800, height: 600 };
  const size = { width: 200, height: 32 };
  const padding = SNAP_PADDING_PX;

  it("clamps chrome position inside bounds", () => {
    expect(clampChromePosition(bounds, size, { x: -20, y: -10 })).toEqual({ x: 0, y: 0 });
    expect(clampChromePosition(bounds, size, { x: 900, y: 700 })).toEqual({
      x: 600,
      y: 568,
    });
    expect(clampChromePosition(bounds, size, { x: 100, y: 50 })).toEqual({ x: 100, y: 50 });
  });

  it("positions chrome on each docked edge", () => {
    expect(positionForEdge(bounds, size, "top", 40, padding)).toEqual({
      x: 40,
      y: padding,
    });
    expect(positionForEdge(bounds, size, "bottom", 40, padding)).toEqual({
      x: 40,
      y: 600 - 32 - padding,
    });
    expect(positionForEdge(bounds, size, "left", 100, padding)).toEqual({
      x: padding,
      y: 100,
    });
    expect(positionForEdge(bounds, size, "right", 100, padding)).toEqual({
      x: 800 - 200 - padding,
      y: 100,
    });
  });

  it("snaps a center near the left edge to left", () => {
    const snap = snapToNearestEdge(bounds, size, { x: 30, y: 300 }, padding);
    expect(snap.edge).toBe("left");
    expect(snap.x).toBe(padding);
    expect(snap.y).toBeGreaterThanOrEqual(padding);
  });

  it("snaps a center near the top edge to top", () => {
    const snap = snapToNearestEdge(bounds, size, { x: 400, y: 20 }, padding);
    expect(snap.edge).toBe("top");
    expect(snap.y).toBe(padding);
  });

  it("keeps snapped chrome fully inside bounds", () => {
    const snap = snapToNearestEdge(bounds, size, { x: 790, y: 590 }, padding);
    expect(snap.x).toBeGreaterThanOrEqual(padding);
    expect(snap.y).toBeGreaterThanOrEqual(padding);
    expect(snap.x + size.width).toBeLessThanOrEqual(bounds.width - padding);
    expect(snap.y + size.height).toBeLessThanOrEqual(bounds.height - padding);
  });

  it("sizes collapsed peek as a thin edge tab", () => {
    expect(collapsedChromeSize("top")).toEqual({ width: 40, height: 8 });
    expect(collapsedChromeSize("left")).toEqual({ width: 8, height: 40 });
  });

  it("centers offset along the docked edge", () => {
    expect(centerOffsetForEdge(bounds, { width: 40, height: 8 }, "top", 0)).toBe((800 - 40) / 2);
    expect(centerOffsetForEdge(bounds, { width: 8, height: 40 }, "left", 0)).toBe((600 - 40) / 2);
  });

  it("places collapsed chrome on the midpoint of an expanded bar", () => {
    // Expanded bar: x=0..100 → center 50; arrow width 10 → left should be 45.
    const expanded = { x: 0, y: 8 };
    const expandedSize = { width: 100, height: 32 };
    const center = alongEdgeCenter("top", expanded, expandedSize);
    expect(center).toBe(50);
    const arrow = { width: 10, height: 8 };
    const placed = positionCenteredOnAlong(bounds, arrow, "top", center, 0);
    expect(placed.x).toBe(45);
    expect(placed.y).toBe(0);
  });
});
