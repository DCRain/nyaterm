import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { NoteOutlineItem } from "@/lib/noteOutline";
import { cn } from "@/lib/utils";

interface NoteOutlineProps {
  items: NoteOutlineItem[];
  activeLine?: number | null;
  onSelect: (item: NoteOutlineItem) => void;
  className?: string;
  style?: CSSProperties;
}

export default function NoteOutline({
  items,
  activeLine,
  onSelect,
  className,
  style,
}: NoteOutlineProps) {
  const { t } = useTranslation();

  return (
    <aside
      className={cn("flex h-full min-h-0 shrink-0 flex-col overflow-hidden", className)}
      style={{
        backgroundColor: "var(--df-bg-panel)",
        color: "var(--df-text)",
        borderRight: "1px solid var(--df-divider, var(--df-border))",
        boxShadow: "none",
        ...style,
      }}
      aria-label={t("notes.outline")}
    >
      <div
        className="shrink-0 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide"
        style={{
          borderBottom: "1px solid var(--df-divider, var(--df-border))",
          backgroundColor: "var(--df-bg-panel)",
          color: "var(--df-text-muted)",
        }}
      >
        {t("notes.outline")}
      </div>
      <div className="terminal-scroll min-h-0 flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="px-2.5 py-3 text-[11px]" style={{ color: "var(--df-text-dimmed)" }}>
            {t("notes.outlineEmpty")}
          </div>
        ) : (
          <nav className="flex flex-col gap-0.5 p-1.5">
            {items.map((item) => {
              const active = activeLine === item.line;
              return (
                <button
                  key={`${item.line}-${item.text}`}
                  type="button"
                  title={item.text}
                  onClick={() => onSelect(item)}
                  className={cn(
                    "truncate rounded px-1.5 py-1 text-left text-[11px] leading-4 transition-colors",
                    active
                      ? "bg-[color-mix(in_srgb,var(--df-primary)_18%,transparent)] text-[var(--df-primary)]"
                      : "text-[var(--df-text-muted)] hover:bg-[color-mix(in_srgb,var(--df-text)_8%,transparent)] hover:text-[var(--df-text)]",
                  )}
                  style={{ paddingLeft: `${0.35 + (item.level - 1) * 0.55}rem` }}
                >
                  {item.text}
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </aside>
  );
}
