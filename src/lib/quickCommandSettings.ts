import type { AppSettings, QuickCommandSortMode, UiConfig } from "@/types/global";

export function normalizeQuickCommandSortMode(
  mode: unknown,
): QuickCommandSortMode {
  return mode === "name" || mode === "useCount" || mode === "custom"
    ? mode
    : "created";
}

export function normalizeQuickCommandUiConfig(ui: UiConfig): UiConfig {
  const quickCommandSortMode = normalizeQuickCommandSortMode(
    ui.quick_cmd_sort_mode,
  );
  return quickCommandSortMode === ui.quick_cmd_sort_mode
    ? ui
    : { ...ui, quick_cmd_sort_mode: quickCommandSortMode };
}

export function normalizeQuickCommandAppSettings(
  settings: AppSettings,
): AppSettings {
  const ui = normalizeQuickCommandUiConfig(settings.ui);
  return ui === settings.ui ? settings : { ...settings, ui };
}
