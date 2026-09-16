export const SETTINGS_OPEN_EVENT = "nyaterm:settings-open";

export interface SettingsOpenDetail {
  section?: string;
}

/** Open settings in the main window workspace tab (handled by App via openSettingsTab). */
export function openSettingsInWorkspace(section?: string) {
  window.dispatchEvent(
    new CustomEvent<SettingsOpenDetail>(SETTINGS_OPEN_EVENT, {
      detail: { section },
    }),
  );
}
