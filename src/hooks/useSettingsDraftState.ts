import { useCallback, useEffect, useRef, useState } from "react";

export type DraftSettingsUpdate<TSettings extends object> =
  | Partial<TSettings>
  | ((prev: TSettings) => Partial<TSettings>);

export function applyDraftSettingsUpdate<TSettings extends object>(
  prev: TSettings,
  updates: DraftSettingsUpdate<TSettings>,
): TSettings {
  const patch = typeof updates === "function" ? updates(prev) : updates;
  return {
    ...prev,
    ...patch,
  };
}

export function useSettingsDraftState<TSettings extends object>(committedSettings: TSettings) {
  const [draftSettings, setDraftSettings] = useState<TSettings>(committedSettings);
  const [isDirty, setIsDirty] = useState(false);
  const lastCommittedSettingsRef = useRef(committedSettings);

  useEffect(() => {
    if (Object.is(lastCommittedSettingsRef.current, committedSettings)) return;
    lastCommittedSettingsRef.current = committedSettings;
    if (isDirty) return;
    setDraftSettings(committedSettings);
  }, [committedSettings, isDirty]);

  const updateDraftSettings = useCallback((updates: DraftSettingsUpdate<TSettings>) => {
    setDraftSettings((prev) => applyDraftSettingsUpdate(prev, updates));
    setIsDirty(true);
  }, []);

  const acceptSavedSettings = useCallback((savedSettings: TSettings) => {
    setDraftSettings(savedSettings);
    setIsDirty(false);
  }, []);

  const discardDraftSettings = useCallback(() => {
    setDraftSettings(committedSettings);
    setIsDirty(false);
  }, [committedSettings]);

  return {
    draftSettings,
    isDirty,
    updateDraftSettings,
    acceptSavedSettings,
    discardDraftSettings,
  };
}
