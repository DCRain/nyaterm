import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PanelHeaderProps {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
}

export default function PanelHeader({
  title,
  meta,
  actions,
  className,
  titleClassName,
}: PanelHeaderProps) {
  return (
    <div
      className={cn(
        "nyaterm-wallpaper-transparent-surface flex min-h-9 shrink-0 items-center justify-between gap-3 border-b px-3",
        className,
      )}
      style={{
        borderColor: "var(--df-border)",
        backgroundColor: "var(--df-bg-section-header)",
      }}
    >
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span
          className={cn(
            "shrink-0 truncate text-[0.6875rem] font-semibold uppercase tracking-[0.16em]",
            titleClassName,
          )}
          style={{ color: "var(--df-text-muted)" }}
        >
          {title}
        </span>
        {meta != null ? (
          <div
            className="min-w-0 truncate text-[0.6875rem]"
            style={{ color: "var(--df-text-dimmed)" }}
          >
            {meta}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}
