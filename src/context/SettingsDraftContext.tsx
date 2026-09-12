import { createContext, useContext } from "react";
import type { DraftSettingsUpdate } from "@/hooks/useSettingsDraftState";
import type { AppSettings } from "@/types/global";

interface SettingsDraftContextValue {
  committedSettings: AppSettings;
  isDirty: boolean;
  isSaving: boolean;
  /**
   * Updates the committed app settings (bypassing the settings draft) and
   * schedules persistence. Use for operations with immediate-effect semantics
   * (e.g. theme designer import/save/delete) so changes apply across windows
   * without waiting for the user to click Apply.
   */
  updateCommittedAppSettings: (updates: DraftSettingsUpdate<AppSettings>) => void;
}

export const SettingsDraftContext = createContext<SettingsDraftContextValue | null>(null);

export function useSettingsDraft() {
  const context = useContext(SettingsDraftContext);
  if (!context) {
    throw new Error("useSettingsDraft must be used within SettingsDraftContext");
  }
  return context;
}
