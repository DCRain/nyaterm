import type { TFunction } from "i18next";
import { Grid2X2, List, Search, X } from "lucide-react";
import type { AssetFilterKey, AssetViewMode } from "./types";

interface AssetToolbarProps {
  t: TFunction;
  totalCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  filters: Set<AssetFilterKey>;
  onToggleFilter: (filter: AssetFilterKey) => void;
  onClearFilters: () => void;
  viewMode: AssetViewMode;
  onViewModeChange: (mode: AssetViewMode) => void;
}

const FILTERS: AssetFilterKey[] = ["linux", "windows", "gpu", "npu"];

export default function AssetToolbar({
  t,
  totalCount,
  search,
  onSearchChange,
  filters,
  onToggleFilter,
  onClearFilters,
  viewMode,
  onViewModeChange,
}: AssetToolbarProps) {
  return (
    <div className="shrink-0 space-y-3 px-5 pb-3" data-total-count={totalCount}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
          style={{ color: "var(--df-text-dimmed)" }}
        />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("assets.searchPlaceholder")}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-full rounded-md border bg-transparent pl-9 pr-8 text-sm outline-none transition-colors placeholder:text-[var(--df-text-dimmed)] focus:border-[var(--df-primary)]"
          style={{
            borderColor: "var(--df-border)",
            color: "var(--df-text)",
            backgroundColor: "color-mix(in srgb, var(--df-bg-hover) 55%, transparent)",
          }}
        />
        {search ? (
          <button
            type="button"
            aria-label={t("common.close")}
            className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded hover:bg-[var(--df-bg-hover)]"
            style={{ color: "var(--df-text-muted)" }}
            onClick={() => onSearchChange("")}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <FilterButton active={filters.size === 0} onClick={onClearFilters}>
            {t("assets.all")}
          </FilterButton>
          {FILTERS.map((filter) => (
            <FilterButton
              key={filter}
              active={filters.has(filter)}
              onClick={() => onToggleFilter(filter)}
            >
              {t(`assets.${filter}`)}
            </FilterButton>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <IconToggleButton
            label={t("assets.list")}
            active={viewMode === "list"}
            onClick={() => onViewModeChange("list")}
          >
            <List className="size-4" />
          </IconToggleButton>
          <IconToggleButton
            label={t("assets.cards")}
            active={viewMode === "cards"}
            onClick={() => onViewModeChange("cards")}
          >
            <Grid2X2 className="size-4" />
          </IconToggleButton>
        </div>
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="h-7 rounded-md border px-2.5 text-xs transition-colors"
      style={{
        borderColor: active ? "var(--df-primary)" : "var(--df-border)",
        color: active ? "var(--df-primary)" : "var(--df-text-muted)",
        backgroundColor: active
          ? "color-mix(in srgb, var(--df-primary) 12%, transparent)"
          : "transparent",
      }}
    >
      {children}
    </button>
  );
}

function IconToggleButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className="flex size-7 items-center justify-center rounded-md border transition-colors"
      style={{
        borderColor: active ? "var(--df-primary)" : "transparent",
        color: active ? "var(--df-primary)" : "var(--df-text-muted)",
        backgroundColor: active
          ? "color-mix(in srgb, var(--df-primary) 10%, transparent)"
          : "transparent",
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
