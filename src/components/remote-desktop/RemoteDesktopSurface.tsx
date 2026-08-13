import {
  type CSSProperties,
  forwardRef,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import type { RemoteDesktopFramePatch } from "@/lib/remoteDesktopFrame";
import { mapClientEventToRemoteDesktopPixel } from "@/lib/remoteDesktopViewport";
import { createRemoteDesktopRenderer, type RemoteDesktopRenderer } from "./renderer";

export type RemoteDesktopScaleMode = "fit" | "actual" | "stretch";

export interface RemoteDesktopSurfaceHandle {
  drawFrame(patch: RemoteDesktopFramePatch): void;
  reset(): void;
  focus(): void;
}

interface RemoteDesktopSurfaceProps {
  scaleMode: RemoteDesktopScaleMode;
  active: boolean;
  visible: boolean;
  inputEnabled?: boolean;
  className?: string;
  children?: ReactNode;
  onPointerMove?: (point: { x: number; y: number }, event: PointerEvent) => void;
  onPointerButton?: (
    point: { x: number; y: number },
    button: number,
    pressed: boolean,
    event: PointerEvent,
  ) => void;
  onWheel?: (point: { x: number; y: number }, event: WheelEvent) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

function canvasStyle(scaleMode: RemoteDesktopScaleMode): CSSProperties {
  if (scaleMode === "stretch") {
    return { width: "100%", height: "100%" };
  }
  if (scaleMode === "actual") {
    return { width: "auto", height: "auto", maxWidth: "none", maxHeight: "none" };
  }
  return { width: "100%", height: "100%", objectFit: "contain" };
}

export const RemoteDesktopSurface = forwardRef<
  RemoteDesktopSurfaceHandle,
  RemoteDesktopSurfaceProps
>(function RemoteDesktopSurface(
  {
    scaleMode,
    active,
    visible,
    inputEnabled = true,
    className,
    children,
    onPointerMove,
    onPointerButton,
    onWheel,
    onFocus,
    onBlur,
  },
  forwardedRef,
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<RemoteDesktopRenderer | null>(null);
  const pendingFramesRef = useRef<RemoteDesktopFramePatch[]>([]);
  const frameRequestRef = useRef<number | null>(null);
  const style = useMemo(() => canvasStyle(scaleMode), [scaleMode]);

  const cancelPendingDraw = useCallback(() => {
    if (frameRequestRef.current !== null) {
      window.cancelAnimationFrame(frameRequestRef.current);
      frameRequestRef.current = null;
    }
    pendingFramesRef.current = [];
  }, []);

  const flushPendingFrames = useCallback(() => {
    frameRequestRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) {
      pendingFramesRef.current = [];
      return;
    }
    const frames = pendingFramesRef.current;
    pendingFramesRef.current = [];
    if (frames.length === 0) return;
    rendererRef.current ??= createRemoteDesktopRenderer(canvas);
    rendererRef.current?.drawMany(frames);
  }, []);

  const scheduleFrameDraw = useCallback(
    (patch: RemoteDesktopFramePatch) => {
      pendingFramesRef.current.push(patch);
      if (frameRequestRef.current !== null) return;
      frameRequestRef.current = window.requestAnimationFrame(flushPendingFrames);
    },
    [flushPendingFrames],
  );

  useImperativeHandle(
    forwardedRef,
    () => ({
      drawFrame(patch) {
        scheduleFrameDraw(patch);
      },
      reset() {
        cancelPendingDraw();
        rendererRef.current?.dispose();
        rendererRef.current = null;
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      },
      focus() {
        rootRef.current?.focus({ preventScroll: true });
      },
    }),
    [cancelPendingDraw, scheduleFrameDraw],
  );

  useEffect(() => {
    return () => {
      cancelPendingDraw();
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [cancelPendingDraw]);

  const getPoint = (event: PointerEvent | WheelEvent) => {
    const canvas = canvasRef.current;
    return canvas ? mapClientEventToRemoteDesktopPixel(canvas, event, scaleMode) : { x: 0, y: 0 };
  };

  return (
    <div
      ref={rootRef}
      className={
        className ??
        "relative flex h-full w-full min-h-0 min-w-0 items-center justify-center overflow-hidden bg-black outline-none"
      }
      data-remote-desktop-input-root="true"
      tabIndex={active && visible ? 0 : -1}
      onFocus={onFocus}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        onBlur?.();
      }}
    >
      <canvas
        ref={canvasRef}
        className="block"
        style={style}
        onPointerMove={
          inputEnabled && onPointerMove
            ? (event: ReactPointerEvent<HTMLCanvasElement>) =>
                onPointerMove(getPoint(event.nativeEvent), event.nativeEvent)
            : undefined
        }
        onPointerDown={
          inputEnabled && onPointerButton
            ? (event: ReactPointerEvent<HTMLCanvasElement>) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                onPointerButton(getPoint(event.nativeEvent), event.button, true, event.nativeEvent);
              }
            : undefined
        }
        onPointerUp={
          inputEnabled && onPointerButton
            ? (event: ReactPointerEvent<HTMLCanvasElement>) =>
                onPointerButton(getPoint(event.nativeEvent), event.button, false, event.nativeEvent)
            : undefined
        }
        onWheel={
          inputEnabled && onWheel
            ? (event) => {
                event.preventDefault();
                onWheel(getPoint(event.nativeEvent), event.nativeEvent);
              }
            : undefined
        }
      />
      {children}
    </div>
  );
});
