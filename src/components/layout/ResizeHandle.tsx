import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  direction: "horizontal" | "vertical";
  onResize: (delta: number) => void;
  className?: string;
}

/** Draggable handle for horizontal or vertical resize. Calls onResize(delta) on drag. */
export default function ResizeHandle({ direction, onResize, className = "" }: ResizeHandleProps) {
  const startPos = useRef(0);
  const onResizeRef = useRef(onResize);
  const draggingRef = useRef(false);

  // Keep the ref up to date
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const target = e.currentTarget;
      // Capture so drags keep working over iframes / WebViews (note editor, terminal).
      target.setPointerCapture(e.pointerId);
      draggingRef.current = true;
      startPos.current = direction === "horizontal" ? e.clientX : e.clientY;

      const endDrag = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        if (target.hasPointerCapture(ev.pointerId)) {
          target.releasePointerCapture(ev.pointerId);
        }
        target.removeEventListener("pointermove", onPointerMove);
        target.removeEventListener("pointerup", endDrag);
        target.removeEventListener("pointercancel", endDrag);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      const onPointerMove = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        const current = direction === "horizontal" ? ev.clientX : ev.clientY;
        const delta = current - startPos.current;
        if (delta === 0) return;
        startPos.current = current;
        onResizeRef.current(delta);
      };

      target.addEventListener("pointermove", onPointerMove);
      target.addEventListener("pointerup", endDrag);
      target.addEventListener("pointercancel", endDrag);
      document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [direction],
  );

  const isHorizontal = direction === "horizontal";

  return (
    <div
      className={cn("group/rh relative shrink-0", isHorizontal ? "w-px" : "h-px", className)}
    >
      {/* 1px visual line — expands on hover/active for easier targeting */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute bg-[var(--df-border)] transition-[width,height,background-color]",
          isHorizontal
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2 group-hover/rh:w-[3px] group-hover/rh:bg-[var(--df-primary)] group-active/rh:w-[3px] group-active/rh:bg-[var(--df-primary)]"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2 group-hover/rh:h-[3px] group-hover/rh:bg-[var(--df-primary)] group-active/rh:h-[3px] group-active/rh:bg-[var(--df-primary)]",
        )}
      />
      {/* Wider invisible hit target so a thin line stays easy to grab */}
      <div
        className={cn(
          "absolute z-10 touch-none",
          isHorizontal
            ? "-left-[6px] inset-y-0 w-[13px] cursor-col-resize"
            : "-top-[6px] inset-x-0 h-[13px] cursor-row-resize",
        )}
        onPointerDown={handlePointerDown}
      />
    </div>
  );
}
