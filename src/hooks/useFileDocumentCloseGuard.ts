import { useCallback, useState } from "react";
import type { PendingFileDocumentClose } from "@/lib/appWorkspaceClose";
import {
  discardFileDocuments,
  getDirtyFileDocumentIds,
  saveFileDocuments,
} from "@/lib/fileDocumentRegistry";

export function useFileDocumentCloseGuard() {
  const [pendingFileDocumentClose, setPendingFileDocumentClose] =
    useState<PendingFileDocumentClose | null>(null);
  const [savingFileDocuments, setSavingFileDocuments] = useState(false);

  const requestFileDocumentClose = useCallback(
    async (paneIds: string[], action: () => Promise<void>) => {
      const dirtyPaneIds = getDirtyFileDocumentIds(new Set(paneIds));
      if (dirtyPaneIds.length === 0) {
        await action();
        return;
      }
      setPendingFileDocumentClose({ paneIds: dirtyPaneIds, action });
    },
    [],
  );

  const handleSaveFileDocumentsAndClose = useCallback(async () => {
    const pending = pendingFileDocumentClose;
    if (!pending || savingFileDocuments) return;

    setSavingFileDocuments(true);
    try {
      if (!(await saveFileDocuments(pending.paneIds))) {
        setPendingFileDocumentClose(null);
        return;
      }
      setPendingFileDocumentClose(null);
      await pending.action();
    } finally {
      setSavingFileDocuments(false);
    }
  }, [pendingFileDocumentClose, savingFileDocuments]);

  const handleDiscardFileDocumentsAndClose = useCallback(() => {
    const pending = pendingFileDocumentClose;
    if (!pending) return;
    discardFileDocuments(pending.paneIds);
    setPendingFileDocumentClose(null);
    void pending.action();
  }, [pendingFileDocumentClose]);

  const handlePendingFileDocumentCloseOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !savingFileDocuments) setPendingFileDocumentClose(null);
    },
    [savingFileDocuments],
  );

  return {
    pendingFileDocumentClose,
    savingFileDocuments,
    requestFileDocumentClose,
    handleSaveFileDocumentsAndClose,
    handleDiscardFileDocumentsAndClose,
    handlePendingFileDocumentCloseOpenChange,
  };
}
