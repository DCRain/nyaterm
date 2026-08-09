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

  // Keep the ref up to date
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startPos.current = direction === "horizontal" ? e.clientX : e.clientY;

      const handleMouseMove = (ev: MouseEvent) => {
        const current = direction === "horizontal" ? ev.clientX : ev.clientY;
        const delta = current - startPos.current;
        startPos.current = current;
        onResizeRef.current(delta);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [direction],
  );

  const isHorizontal = direction === "horizontal";

  return (
    <div
      className={cn("group/rh relative shrink-0", isHorizontal ? "w-px" : "h-px", className)}
    >
      {/* 1px visual line — layout size stays thin */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute bg-[var(--df-border)] transition-colors group-hover/rh:bg-[var(--df-primary)]",
          isHorizontal ? "inset-y-0 left-0 w-px" : "inset-x-0 top-0 h-px",
        )}
      />
      {/* Wider invisible hit target so a thin line stays easy to grab */}
      <div
        className={cn(
          "absolute z-10",
          isHorizontal
            ? "-left-[6px] inset-y-0 w-[13px] cursor-col-resize"
            : "-top-[6px] inset-x-0 h-[13px] cursor-row-resize",
        )}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}
