import { useCallback, useState } from "react";
import type { PendingSettingsPaneClose } from "@/lib/appWorkspaceClose";
import {
  discardSettingsPanes,
  getDirtySettingsPaneIds,
  saveSettingsPanes,
} from "@/lib/settingsPaneRegistry";

export function useSettingsCloseGuard() {
  const [pendingSettingsPaneClose, setPendingSettingsPaneClose] =
    useState<PendingSettingsPaneClose | null>(null);
  const [savingSettingsPanes, setSavingSettingsPanes] = useState(false);

  const requestSettingsPaneClose = useCallback(
    async (paneIds: string[], action: () => Promise<void>) => {
      const dirtyPaneIds = getDirtySettingsPaneIds(new Set(paneIds));
      if (dirtyPaneIds.length === 0) {
        await action();
        return;
      }
      setPendingSettingsPaneClose({ paneIds: dirtyPaneIds, action });
    },
    [],
  );

  const handleSaveSettingsPanesAndClose = useCallback(async () => {
    const pending = pendingSettingsPaneClose;
    if (!pending || savingSettingsPanes) return;

    setSavingSettingsPanes(true);
    try {
      if (!(await saveSettingsPanes(pending.paneIds))) {
        setPendingSettingsPaneClose(null);
        return;
      }
      setPendingSettingsPaneClose(null);
      await pending.action();
    } finally {
      setSavingSettingsPanes(false);
    }
  }, [pendingSettingsPaneClose, savingSettingsPanes]);

  const handleDiscardSettingsPanesAndClose = useCallback(() => {
    const pending = pendingSettingsPaneClose;
    if (!pending) return;
    discardSettingsPanes(pending.paneIds);
    setPendingSettingsPaneClose(null);
    void pending.action();
  }, [pendingSettingsPaneClose]);

  const handlePendingSettingsPaneCloseOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !savingSettingsPanes) setPendingSettingsPaneClose(null);
    },
    [savingSettingsPanes],
  );

  return {
    pendingSettingsPaneClose,
    savingSettingsPanes,
    requestSettingsPaneClose,
    handleSaveSettingsPanesAndClose,
    handleDiscardSettingsPanesAndClose,
    handlePendingSettingsPaneCloseOpenChange,
  };
}
