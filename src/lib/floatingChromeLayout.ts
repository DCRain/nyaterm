export type DockEdge = "top" | "right" | "bottom" | "left";

export interface ChromeBounds {
  width: number;
  height: number;
}

export interface ChromeSize {
  width: number;
  height: number;
}

export interface ChromePoint {
  x: number;
  y: number;
}

export interface SnapResult {
  edge: DockEdge;
  offset: number;
  x: number;
  y: number;
}

/** Delay before expanded chrome collapses when idle (ms). */
export const COLLAPSE_DELAY_MS = 3000;

/**
 * Collapsed chrome is an activity-bar style edge chevron tab.
 * Thickness is the axis into the pane; length runs along the edge.
 */
export const COLLAPSED_PEEK_THICKNESS_PX = 8;
export const COLLAPSED_PEEK_LENGTH_PX = 40;

/** Extra hover slop beyond the visible tab (CSS px). */
export const COLLAPSED_HIT_SLOP_PX = 4;

/** @deprecated Prefer COLLAPSED_PEEK_* — kept for callers expecting a single size. */
export const COLLAPSED_SIZE_PX = COLLAPSED_PEEK_LENGTH_PX;

/** Inset from pane edges when docking expanded chrome (CSS px). */
export const SNAP_PADDING_PX = 8;

/** Collapsed tab sits flush against the edge. */
export const COLLAPSED_SNAP_PADDING_PX = 0;

/** Collapse / expand motion duration (ms). */
export const CHROME_MOTION_MS = 200;

export function collapsedChromeSize(edge: DockEdge): ChromeSize {
  if (edge === "left" || edge === "right") {
    return { width: COLLAPSED_PEEK_THICKNESS_PX, height: COLLAPSED_PEEK_LENGTH_PX };
  }
  return { width: COLLAPSED_PEEK_LENGTH_PX, height: COLLAPSED_PEEK_THICKNESS_PX };
}

/** Offset that centers the chrome along the docked edge of the pane. */
export function centerOffsetForEdge(
  bounds: ChromeBounds,
  size: ChromeSize,
  edge: DockEdge,
  _padding: number = SNAP_PADDING_PX,
): number {
  if (edge === "top" || edge === "bottom") {
    return Math.max(0, (bounds.width - size.width) / 2);
  }
  return Math.max(0, (bounds.height - size.height) / 2);
}

/**
 * Along-edge center of a chrome box (x for top/bottom, y for left/right).
 * Used so collapse places the arrow at the midpoint of the expanded toolbar.
 */
export function alongEdgeCenter(edge: DockEdge, position: ChromePoint, size: ChromeSize): number {
  if (edge === "top" || edge === "bottom") {
    return position.x + size.width / 2;
  }
  return position.y + size.height / 2;
}

/** Top-left position that keeps `alongCenter` as the chrome midpoint on `edge`. */
export function positionCenteredOnAlong(
  bounds: ChromeBounds,
  size: ChromeSize,
  edge: DockEdge,
  alongCenter: number,
  padding: number = SNAP_PADDING_PX,
): SnapResult {
  const offset =
    edge === "top" || edge === "bottom"
      ? alongCenter - size.width / 2
      : alongCenter - size.height / 2;
  const point = positionForEdge(bounds, size, edge, offset, padding);
  const resolvedOffset = edge === "top" || edge === "bottom" ? point.x : point.y;
  return { edge, offset: resolvedOffset, x: point.x, y: point.y };
}

export function clampChromePosition(
  bounds: ChromeBounds,
  size: ChromeSize,
  point: ChromePoint,
): ChromePoint {
  const maxX = Math.max(0, bounds.width - size.width);
  const maxY = Math.max(0, bounds.height - size.height);
  return {
    x: Math.min(maxX, Math.max(0, point.x)),
    y: Math.min(maxY, Math.max(0, point.y)),
  };
}

function clampAlongEdge(
  offset: number,
  boundsAlong: number,
  sizeAlong: number,
  padding: number,
): number {
  const min = padding;
  const max = Math.max(padding, boundsAlong - sizeAlong - padding);
  return Math.min(max, Math.max(min, offset));
}

/** Map docked edge + along-edge offset to top-left CSS position inside the bounds. */
export function positionForEdge(
  bounds: ChromeBounds,
  size: ChromeSize,
  edge: DockEdge,
  offset: number,
  padding: number = SNAP_PADDING_PX,
): ChromePoint {
  switch (edge) {
    case "top":
      return {
        x: clampAlongEdge(offset, bounds.width, size.width, padding),
        y: padding,
      };
    case "bottom":
      return {
        x: clampAlongEdge(offset, bounds.width, size.width, padding),
        y: Math.max(padding, bounds.height - size.height - padding),
      };
    case "left":
      return {
        x: padding,
        y: clampAlongEdge(offset, bounds.height, size.height, padding),
      };
    case "right":
      return {
        x: Math.max(padding, bounds.width - size.width - padding),
        y: clampAlongEdge(offset, bounds.height, size.height, padding),
      };
  }
}

/** Snap chrome center to the nearest of the four padded edges. */
export function snapToNearestEdge(
  bounds: ChromeBounds,
  size: ChromeSize,
  center: ChromePoint,
  padding: number = SNAP_PADDING_PX,
): SnapResult {
  const distLeft = Math.max(0, center.x - padding);
  const distRight = Math.max(0, bounds.width - padding - center.x);
  const distTop = Math.max(0, center.y - padding);
  const distBottom = Math.max(0, bounds.height - padding - center.y);

  const candidates: Array<{ edge: DockEdge; distance: number }> = [
    { edge: "left", distance: distLeft },
    { edge: "right", distance: distRight },
    { edge: "top", distance: distTop },
    { edge: "bottom", distance: distBottom },
  ];
  candidates.sort((a, b) => a.distance - b.distance);
  const edge = candidates[0]?.edge ?? "top";

  const offset =
    edge === "top" || edge === "bottom" ? center.x - size.width / 2 : center.y - size.height / 2;

  const point = positionForEdge(bounds, size, edge, offset, padding);
  const resolvedOffset = edge === "top" || edge === "bottom" ? point.x : point.y;

  return { edge, offset: resolvedOffset, x: point.x, y: point.y };
}
