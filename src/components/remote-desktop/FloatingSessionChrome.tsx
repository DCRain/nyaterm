import { Maximize2, Minimize2, Monitor, Power, RotateCcw } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { MdChevronLeft, MdChevronRight, MdExpandLess, MdExpandMore } from "react-icons/md";
import { Button } from "@/components/ui/button";
import {
  CHROME_MOTION_MS,
  COLLAPSE_DELAY_MS,
  COLLAPSED_HIT_SLOP_PX,
  COLLAPSED_SNAP_PADDING_PX,
  collapsedChromeSize,
  type DockEdge,
  SNAP_PADDING_PX,
  snapToNearestEdge,
} from "@/lib/floatingChromeLayout";
import { cn } from "@/lib/utils";

export const TOGGLE_REMOTE_DESKTOP_CHROME_EVENT = "nyaterm:toggle-remote-desktop-chrome";

type FloatingChromeMode = "expanded" | "collapsed" | "hidden";

export type RemoteDesktopNetworkQuality = "good" | "fair" | "poor" | "unknown";

export interface RemoteDesktopNetworkStatus {
  latencyMs: number | null;
  fps: number;
  quality: RemoteDesktopNetworkQuality;
}

export interface FloatingSessionChromeProps {
  sessionId: string;
  title: string;
  subtitle?: string | null;
  networkStatus?: RemoteDesktopNetworkStatus | null;
  boundsRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  active?: boolean;
  forceVisibleOnEnable?: boolean;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  onReconnect: () => void;
  onClose: () => void;
  shortcutPopover?: ReactNode;
  extraCollapsedIcon?: ReactNode;
  className?: string;
}

function readBounds(el: HTMLElement | null) {
  if (!el) return { width: 0, height: 0 };
  const rect = el.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function collapsedHitSize(edge: DockEdge) {
  const peek = collapsedChromeSize(edge);
  if (edge === "left" || edge === "right") {
    return { width: peek.width + COLLAPSED_HIT_SLOP_PX, height: peek.height };
  }
  return { width: peek.width, height: peek.height + COLLAPSED_HIT_SLOP_PX };
}

function edgePadding(mode: FloatingChromeMode) {
  return mode === "collapsed" ? COLLAPSED_SNAP_PADDING_PX : SNAP_PADDING_PX;
}

function ExpandChevron({ edge }: { edge: DockEdge }) {
  const className = "text-xs shrink-0";
  switch (edge) {
    case "left":
      return <MdChevronRight className={className} />;
    case "right":
      return <MdChevronLeft className={className} />;
    case "bottom":
      return <MdExpandLess className={className} />;
    default:
      return <MdExpandMore className={className} />;
  }
}

function clampAlongCenter(along: number, sizeAlong: number, boundAlong: number, padding: number) {
  const half = sizeAlong / 2;
  const min = padding + half;
  const max = Math.max(min, boundAlong - padding - half);
  return Math.min(max, Math.max(min, along));
}

/** Rest pose: centered on the docked edge. */
function restTransform(edge: DockEdge): string {
  return edge === "top" || edge === "bottom" ? "translateX(-50%)" : "translateY(-50%)";
}

/**
 * Slide-in start pose by edge:
 * top → down, bottom → up, left → right, right → left.
 */
function enterTransform(edge: DockEdge): string {
  switch (edge) {
    case "top":
      return "translateX(-50%) translateY(-110%)";
    case "bottom":
      return "translateX(-50%) translateY(110%)";
    case "left":
      return "translateY(-50%) translateX(-110%)";
    case "right":
      return "translateY(-50%) translateX(110%)";
  }
}

function dockPosition(edge: DockEdge, along: number, mode: FloatingChromeMode): CSSProperties {
  const padding = edgePadding(mode);
  switch (edge) {
    case "top":
      return { left: along, top: padding };
    case "bottom":
      return { left: along, bottom: padding, top: "auto" };
    case "left":
      return { left: padding, top: along };
    case "right":
      return { right: padding, left: "auto", top: along };
  }
}

function qualityTone(quality: RemoteDesktopNetworkQuality): string {
  switch (quality) {
    case "good":
      return "#4ade80";
    case "fair":
      return "#fbbf24";
    case "poor":
      return "#f87171";
    default:
      return "rgba(255,255,255,0.45)";
  }
}

function qualityLabelKey(quality: RemoteDesktopNetworkQuality): string {
  switch (quality) {
    case "good":
      return "dialog.rdpNetworkGood";
    case "fair":
      return "dialog.rdpNetworkFair";
    case "poor":
      return "dialog.rdpNetworkPoor";
    default:
      return "dialog.rdpNetworkUnknown";
  }
}

export function FloatingSessionChrome({
  sessionId,
  title,
  subtitle = null,
  networkStatus = null,
  boundsRef,
  enabled,
  active = false,
  forceVisibleOnEnable = true,
  onToggleFullscreen,
  isFullscreen = false,
  onReconnect,
  onClose,
  shortcutPopover,
  extraCollapsedIcon,
  className,
}: FloatingSessionChromeProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [mode, setMode] = useState<FloatingChromeMode>("expanded");
  const [edge, setEdge] = useState<DockEdge>("top");
  /** Center along the docked edge (x for top/bottom, y for left/right). */
  const [along, setAlong] = useState(0);
  /** When true, chrome is at rest transform; when false (expanding), starts off-edge. */
  const [settled, setSettled] = useState(true);
  const [dragging, setDragging] = useState(false);

  const edgeRef = useRef(edge);
  const modeRef = useRef(mode);
  const alongRef = useRef(along);
  const draggingRef = useRef(false);
  const hoveringRef = useRef(false);
  const collapseTimerRef = useRef<number | null>(null);
  const sizeRef = useRef({ width: 280, height: 32 });
  const dragOriginRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originAlong: number;
  } | null>(null);

  edgeRef.current = edge;
  modeRef.current = mode;
  alongRef.current = along;
  draggingRef.current = dragging;

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  }, []);

  const measureSize = useCallback(() => {
    const el = rootRef.current;
    if (!el) return sizeRef.current;
    if (modeRef.current === "collapsed") {
      return collapsedHitSize(edgeRef.current);
    }
    const width = Math.max(el.scrollWidth, el.offsetWidth);
    const height = Math.max(el.scrollHeight, el.offsetHeight);
    if (width > 8 && height > 8) {
      sizeRef.current = { width, height };
    }
    return sizeRef.current;
  }, []);

  const collapseToArrow = useCallback(() => {
    measureSize();
    // Slide the bar back into the docked edge, then swap to the arrow.
    setSettled(false);
    window.setTimeout(() => {
      if (modeRef.current !== "expanded") return;
      setMode("collapsed");
      setSettled(true);
    }, CHROME_MOTION_MS);
  }, [measureSize]);

  const expandFromArrow = useCallback(() => {
    setMode("expanded");
    setSettled(false);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setSettled(true);
      });
    });
  }, []);

  const armCollapseTimer = useCallback(() => {
    clearCollapseTimer();
    if (modeRef.current !== "expanded") return;
    if (hoveringRef.current || draggingRef.current) return;
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null;
      if (hoveringRef.current || draggingRef.current) return;
      if (modeRef.current !== "expanded") return;
      collapseToArrow();
    }, COLLAPSE_DELAY_MS);
  }, [clearCollapseTimer, collapseToArrow]);

  useLayoutEffect(() => {
    if (!enabled || mode !== "expanded" || draggingRef.current) return;
    const size = measureSize();
    const bounds = readBounds(boundsRef.current);
    if (bounds.width <= 0) return;
    const alongBound = edge === "top" || edge === "bottom" ? bounds.width : bounds.height;
    const sizeAlong = edge === "top" || edge === "bottom" ? size.width : size.height;
    const next = clampAlongCenter(alongRef.current, sizeAlong, alongBound, edgePadding("expanded"));
    if (Math.abs(next - alongRef.current) > 0.5) {
      alongRef.current = next;
      setAlong(next);
    }
  }, [boundsRef, edge, enabled, measureSize, mode, title, subtitle, networkStatus]);

  const prevEnabledRef = useRef(false);
  useEffect(() => {
    const becameEnabled = enabled && !prevEnabledRef.current;
    prevEnabledRef.current = enabled;

    if (!enabled) {
      clearCollapseTimer();
      return;
    }

    if (becameEnabled && forceVisibleOnEnable) {
      hoveringRef.current = false;
      setEdge("top");
      edgeRef.current = "top";
      setMode("expanded");
      setSettled(false);

      window.requestAnimationFrame(() => {
        const size = measureSize();
        const bounds = readBounds(boundsRef.current);
        const initialAlong = SNAP_PADDING_PX + size.width / 2;
        const clamped = clampAlongCenter(initialAlong, size.width, bounds.width, SNAP_PADDING_PX);
        alongRef.current = clamped;
        setAlong(clamped);
        window.requestAnimationFrame(() => {
          setSettled(true);
          armCollapseTimer();
        });
      });
    }
  }, [enabled, forceVisibleOnEnable, armCollapseTimer, boundsRef, clearCollapseTimer, measureSize]);

  useEffect(() => () => clearCollapseTimer(), [clearCollapseTimer]);

  useEffect(() => {
    const onToggle = () => {
      if (!enabled || !active) return;
      if (modeRef.current === "hidden") {
        expandFromArrow();
        armCollapseTimer();
        return;
      }
      clearCollapseTimer();
      setMode("hidden");
    };
    window.addEventListener(TOGGLE_REMOTE_DESKTOP_CHROME_EVENT, onToggle);
    return () => window.removeEventListener(TOGGLE_REMOTE_DESKTOP_CHROME_EVENT, onToggle);
  }, [active, armCollapseTimer, clearCollapseTimer, enabled, expandFromArrow]);

  useEffect(() => {
    const boundsEl = boundsRef.current;
    if (!boundsEl || !enabled || mode === "hidden") return;
    const onResize = () => {
      if (draggingRef.current) return;
      const bounds = readBounds(boundsEl);
      const forEdge = edgeRef.current;
      const size = measureSize();
      const alongBound = forEdge === "top" || forEdge === "bottom" ? bounds.width : bounds.height;
      const sizeAlong = forEdge === "top" || forEdge === "bottom" ? size.width : size.height;
      const next = clampAlongCenter(
        alongRef.current,
        sizeAlong,
        alongBound,
        edgePadding(modeRef.current),
      );
      alongRef.current = next;
      setAlong(next);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(boundsEl);
    return () => observer.disconnect();
  }, [boundsRef, enabled, measureSize, mode]);

  const isolatePointer = (event: ReactPointerEvent) => {
    event.stopPropagation();
  };

  const handlePointerEnter = () => {
    if (!enabled || modeRef.current === "hidden") return;
    hoveringRef.current = true;
    clearCollapseTimer();
    if (modeRef.current === "collapsed") {
      expandFromArrow();
    }
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    hoveringRef.current = false;
    if (!enabled || modeRef.current === "hidden" || draggingRef.current) return;
    if (modeRef.current === "expanded") armCollapseTimer();
  };

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !enabled || mode === "hidden") return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button:not([data-chrome-drag-handle='true'])")) return;

    event.preventDefault();
    event.stopPropagation();
    clearCollapseTimer();
    measureSize();

    dragOriginRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originAlong: alongRef.current,
    };
    draggingRef.current = true;
    setDragging(true);
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const onDragMove = (event: ReactPointerEvent<HTMLElement>) => {
    const origin = dragOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    event.stopPropagation();

    const bounds = readBounds(boundsRef.current);
    const size =
      modeRef.current === "collapsed" ? collapsedHitSize(edgeRef.current) : sizeRef.current;
    const horizontal = edgeRef.current === "top" || edgeRef.current === "bottom";
    const delta = horizontal
      ? event.clientX - origin.startClientX
      : event.clientY - origin.startClientY;
    const alongBound = horizontal ? bounds.width : bounds.height;
    const sizeAlong = horizontal ? size.width : size.height;
    const next = clampAlongCenter(
      origin.originAlong + delta,
      sizeAlong,
      alongBound,
      edgePadding(modeRef.current),
    );
    alongRef.current = next;
    setAlong(next);
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const origin = dragOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    event.stopPropagation();

    try {
      rootRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }

    const bounds = readBounds(boundsRef.current);
    const size =
      modeRef.current === "collapsed" ? collapsedHitSize(edgeRef.current) : sizeRef.current;
    const horizontal = edgeRef.current === "top" || edgeRef.current === "bottom";
    const center = {
      x: horizontal
        ? alongRef.current
        : edgeRef.current === "left"
          ? size.width / 2
          : bounds.width - size.width / 2,
      y: horizontal
        ? edgeRef.current === "top"
          ? size.height / 2
          : bounds.height - size.height / 2
        : alongRef.current,
    };
    const snap = snapToNearestEdge(bounds, size, center, edgePadding(modeRef.current));
    edgeRef.current = snap.edge;
    setEdge(snap.edge);
    const snappedAlong =
      snap.edge === "top" || snap.edge === "bottom"
        ? snap.x + size.width / 2
        : snap.y + size.height / 2;
    alongRef.current = snappedAlong;
    setAlong(snappedAlong);

    dragOriginRef.current = null;
    draggingRef.current = false;
    setDragging(false);

    if (!hoveringRef.current && modeRef.current === "expanded") {
      armCollapseTimer();
    }
  };

  if (!enabled || mode === "hidden") {
    return null;
  }

  const collapsed = mode === "collapsed";
  const motion = `${CHROME_MOTION_MS}ms`;
  const arrowSize = collapsedHitSize(edge);
  const transform = settled ? restTransform(edge) : enterTransform(edge);
  const qualityColor = networkStatus ? qualityTone(networkStatus.quality) : null;
  const networkParts: string[] = [];
  if (networkStatus) {
    if (networkStatus.latencyMs != null) {
      networkParts.push(`${networkStatus.latencyMs}ms`);
    }
    networkParts.push(`${networkStatus.fps}fps`);
  }
  const networkText = networkParts.join(" · ");
  const networkAria = networkStatus
    ? t("dialog.rdpNetworkStatus", {
        quality: t(qualityLabelKey(networkStatus.quality)),
        latency:
          networkStatus.latencyMs != null
            ? t("dialog.rdpNetworkLatency", { ms: networkStatus.latencyMs })
            : t("dialog.rdpNetworkLatencyUnavailable"),
        fps: t("dialog.rdpNetworkFps", { fps: networkStatus.fps }),
      })
    : undefined;

  return (
    <div
      ref={rootRef}
      data-session-id={sessionId}
      data-floating-session-chrome="true"
      data-chrome-collapsed={collapsed ? "true" : undefined}
      className={cn(
        "absolute z-20 text-xs text-white will-change-transform",
        collapsed
          ? "cursor-grab"
          : "flex w-max cursor-grab items-center gap-1 rounded border border-white/15 bg-black/65 px-1.5 py-1 shadow-sm",
        dragging && "cursor-grabbing",
        className,
      )}
      style={{
        ...dockPosition(edge, along, mode),
        ...(collapsed ? { width: arrowSize.width, height: arrowSize.height } : null),
        transform,
        opacity: settled || collapsed ? 1 : 0.85,
        transition: dragging
          ? undefined
          : `transform ${motion} ease-out, opacity ${motion} ease-out`,
      }}
      role="toolbar"
      aria-label={t("dialog.remoteDesktopChromeToolbar")}
      title={collapsed ? t("dialog.remoteDesktopChromeExpand") : undefined}
      onPointerDown={isolatePointer}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerMove={dragging ? onDragMove : undefined}
      onPointerUp={dragging ? endDrag : undefined}
      onPointerCancel={dragging ? endDrag : undefined}
    >
      {collapsed ? (
        <button
          type="button"
          data-chrome-drag-handle="true"
          className={cn(
            "relative flex h-full w-full cursor-grab items-center justify-center border border-white/10 bg-black/30 text-white/70 outline-none transition-colors",
            "hover:bg-black/45 hover:text-white/90",
            "focus-visible:ring-1 focus-visible:ring-white/40",
            edge === "top" && "rounded-b-sm",
            edge === "bottom" && "rounded-t-sm",
            edge === "left" && "rounded-r-sm",
            edge === "right" && "rounded-l-sm",
          )}
          aria-label={
            networkAria
              ? `${t("dialog.remoteDesktopChromeExpand")} · ${networkAria}`
              : t("dialog.remoteDesktopChromeExpand")
          }
          onPointerDown={beginDrag}
        >
          <ExpandChevron edge={edge} />
          {qualityColor ? (
            <span
              className="pointer-events-none absolute right-1 top-1 size-1.5 rounded-full"
              style={{ backgroundColor: qualityColor }}
              aria-hidden="true"
            />
          ) : null}
        </button>
      ) : (
        <>
          <button
            type="button"
            data-chrome-drag-handle="true"
            className="flex items-center gap-1 rounded outline-none focus-visible:ring-1 focus-visible:ring-white/40"
            title={t("dialog.remoteDesktopChromeDrag")}
            aria-label={t("dialog.remoteDesktopChromeDrag")}
            onPointerDown={beginDrag}
          >
            <Monitor className="h-3.5 w-3.5 shrink-0" />
            {extraCollapsedIcon}
          </button>

          <span className="max-w-40 truncate select-none" onPointerDown={beginDrag}>
            {title}
          </span>
          {subtitle ? (
            <span className="shrink-0 text-white/55 select-none" onPointerDown={beginDrag}>
              {subtitle}
            </span>
          ) : null}
          {networkStatus ? (
            <span
              className="flex shrink-0 items-center gap-1 select-none"
              title={networkAria}
              aria-label={networkAria}
              onPointerDown={beginDrag}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: qualityColor ?? undefined }}
                aria-hidden="true"
              />
              <span className="font-mono tabular-nums text-white/70">{networkText}</span>
            </span>
          ) : null}
          {shortcutPopover}
          <Button
            variant="ghost"
            size="icon-xs"
            className="h-6 w-6 shrink-0 text-white"
            title={t("dialog.rdpReconnect")}
            aria-label={t("dialog.rdpReconnect")}
            onClick={onReconnect}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="h-6 w-6 shrink-0 text-white"
            title={t("dialog.remoteDesktopChromeClose")}
            aria-label={t("dialog.remoteDesktopChromeClose")}
            onClick={onClose}
          >
            <Power className="h-3.5 w-3.5" />
          </Button>
          {onToggleFullscreen ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="h-6 w-6 shrink-0 text-white"
              title={isFullscreen ? t("dialog.rdpExitFullscreen") : t("dialog.rdpFullscreen")}
              aria-label={isFullscreen ? t("dialog.rdpExitFullscreen") : t("dialog.rdpFullscreen")}
              onClick={onToggleFullscreen}
            >
              {isFullscreen ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

export default FloatingSessionChrome;
