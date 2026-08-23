import type { ReactNode } from "react";
import { MdClose } from "react-icons/md";
import ResizeHandle from "@/components/layout/ResizeHandle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FloatingPanelProps {
  side: "left" | "right";
  panelId: string;
  width: number;
  title: string;
  onClose: () => void;
  onResize: (delta: number) => void;
  children: ReactNode;
}

export default function FloatingPanel({
  side,
  panelId,
  width,
  title,
  onClose,
  onResize,
  children,
}: FloatingPanelProps) {
  const isLeft = side === "left";

  return (
    <div
      data-floating-panel-id={panelId}
      className={cn(
        "absolute inset-y-0 z-30 flex min-w-0 overflow-visible shadow-2xl",
        isLeft ? "left-0 flex-row" : "right-0 flex-row",
      )}
      style={{
        width: `min(${width}px, calc(100% - 48px))`,
      }}
    >
      {!isLeft && <ResizeHandle direction="horizontal" onResize={onResize} />}
      <aside
        className={cn(
          "relative flex min-w-0 flex-1 flex-col overflow-hidden",
          isLeft ? "border-r" : "border-l",
        )}
        style={{
          backgroundColor: "var(--df-bg-panel)",
          borderColor: "var(--df-border)",
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn(
            "absolute top-1 z-10 text-[var(--df-text-muted)] hover:bg-[color-mix(in_srgb,var(--df-text-muted)_10%,transparent)] hover:text-[var(--df-text)]",
            isLeft ? "right-1" : "left-1",
          )}
          title={title}
          aria-label={title}
          onClick={onClose}
        >
          <MdClose />
        </Button>
        <div className="h-full min-h-0 overflow-hidden">{children}</div>
      </aside>
      {isLeft && <ResizeHandle direction="horizontal" onResize={onResize} />}
    </div>
  );
}
