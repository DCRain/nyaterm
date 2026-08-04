import type { TFunction } from "i18next";
import { Check, ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buildGroupPath } from "@/lib/assetGroups";
import type { Group } from "@/types/global";
import type { AssetGroupOption } from "./types";

interface AssetBreadcrumbProps {
  t: TFunction;
  groups: Group[];
  selectedGroupId: string | null;
  resultCount: number;
  groupOptions: AssetGroupOption[];
  onSelectGroup: (groupId: string | null) => void;
}

export default function AssetBreadcrumb({
  t,
  groups,
  selectedGroupId,
  resultCount,
  groupOptions,
  onSelectGroup,
}: AssetBreadcrumbProps) {
  const [open, setOpen] = useState(false);
  const path = useMemo(() => buildGroupPath(groups, selectedGroupId), [groups, selectedGroupId]);
  const displayPath =
    path.length > 4 ? [path[0], { id: "__more__", name: "..." }, ...path.slice(-2)] : path;

  return (
    <div
      className="flex min-h-9 shrink-0 items-center justify-between gap-3 border-y px-5 text-xs"
      style={{
        borderColor: "var(--df-border)",
        backgroundColor: "color-mix(in srgb, var(--df-bg-panel) 50%, transparent)",
      }}
    >
      <div className="flex min-w-0 items-center gap-1">
        {displayPath.map((segment, index) => {
          const isRoot = segment.id === null;
          const isLast = index === displayPath.length - 1;
          const label = isRoot ? t("assets.title") : segment.name;
          if (segment.id === "__more__") {
            return (
              <span
                key="more"
                className="flex min-w-0 items-center gap-1"
                style={{ color: "var(--df-text-dimmed)" }}
              >
                <ChevronRight className="size-3" />
                <MoreHorizontal className="size-4" aria-label={t("common.more")} />
              </span>
            );
          }
          return (
            <span key={segment.id ?? "root"} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <ChevronRight
                  className="size-3 shrink-0"
                  style={{ color: "var(--df-text-dimmed)" }}
                />
              ) : null}
              {isLast ? (
                <span className="truncate font-medium" style={{ color: "var(--df-text)" }}>
                  {label}
                </span>
              ) : (
                <button
                  type="button"
                  className="truncate rounded px-1 py-0.5 transition-colors hover:bg-[var(--df-bg-hover)]"
                  style={{ color: "var(--df-text-muted)" }}
                  onClick={() => onSelectGroup(isRoot ? null : segment.id)}
                >
                  {label}
                </button>
              )}
            </span>
          );
        })}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t("assets.groupPickerPlaceholder")}
              className="ml-1 flex size-6 items-center justify-center rounded hover:bg-[var(--df-bg-hover)]"
              style={{ color: "var(--df-text-muted)" }}
            >
              <ChevronDown className="size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <Command>
              <CommandInput placeholder={t("assets.groupPickerPlaceholder")} />
              <CommandList className="terminal-scroll max-h-72">
                <CommandEmpty>{t("assets.noResults")}</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value={t("assets.title")}
                    onSelect={() => {
                      onSelectGroup(null);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{t("assets.title")}</span>
                    {selectedGroupId === null ? (
                      <Check className="size-4 text-[var(--df-primary)]" />
                    ) : null}
                  </CommandItem>
                  {groupOptions.map((option) => (
                    <CommandItem
                      key={option.group.id}
                      value={option.searchText}
                      onSelect={() => {
                        onSelectGroup(option.group.id);
                        setOpen(false);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.path}</span>
                      {selectedGroupId === option.group.id ? (
                        <Check className="size-4 text-[var(--df-primary)]" />
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <span className="shrink-0 tabular-nums" style={{ color: "var(--df-text-muted)" }}>
        {t("assets.items", { count: resultCount })}
      </span>
    </div>
  );
}
