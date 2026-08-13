import type { RemoteDesktopScaleMode } from "@/types/global";

export interface RemoteDesktopViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function getRemoteDesktopContentRect(
  canvas: HTMLCanvasElement,
  scaleMode: RemoteDesktopScaleMode = "fit",
): RemoteDesktopViewportRect {
  const rect = canvas.getBoundingClientRect();
  const desktopWidth = canvas.width;
  const desktopHeight = canvas.height;
  if (rect.width <= 0 || rect.height <= 0 || desktopWidth <= 0 || desktopHeight <= 0) {
    return rect;
  }

  if (scaleMode === "stretch" || scaleMode === "actual") {
    return rect;
  }

  const scale = Math.min(rect.width / desktopWidth, rect.height / desktopHeight);
  const width = desktopWidth * scale;
  const height = desktopHeight * scale;
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
}

export function mapClientPointToRemoteDesktopPixel(
  rect: RemoteDesktopViewportRect,
  desktopWidth: number,
  desktopHeight: number,
  clientX: number,
  clientY: number,
) {
  const maxX = Math.max(0, desktopWidth - 1);
  const maxY = Math.max(0, desktopHeight - 1);
  if (rect.width <= 0 || rect.height <= 0 || desktopWidth <= 0 || desktopHeight <= 0) {
    return { x: 0, y: 0 };
  }

  const cssX = clamp(clientX - rect.left, 0, rect.width);
  const cssY = clamp(clientY - rect.top, 0, rect.height);
  return {
    x: clamp(Math.floor((cssX / rect.width) * desktopWidth), 0, maxX),
    y: clamp(Math.floor((cssY / rect.height) * desktopHeight), 0, maxY),
  };
}

export function mapClientEventToRemoteDesktopPixel(
  canvas: HTMLCanvasElement,
  event: Pick<PointerEvent | WheelEvent, "clientX" | "clientY">,
  scaleMode: RemoteDesktopScaleMode = "fit",
) {
  return mapClientPointToRemoteDesktopPixel(
    getRemoteDesktopContentRect(canvas, scaleMode),
    canvas.width,
    canvas.height,
    event.clientX,
    event.clientY,
  );
}
