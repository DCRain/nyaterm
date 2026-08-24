import type { TFunction } from "i18next";
import ExternalConnectionMatchDialog from "@/components/dialog/connections/ExternalConnectionMatchDialog";
import TemporarySshLinkDialog from "@/components/dialog/connections/TemporarySshLinkDialog";
import UnsavedChangesDialog from "@/components/dialog/remote-file-editor/UnsavedChangesDialog";
import SessionQuickSwitcher, {
  type QuickSwitcherSession,
} from "@/components/dialog/terminal/SessionQuickSwitcherDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ExternalMatchDialogState, PostLoginConfirmState } from "@/lib/appExternalDialogs";
import type { PendingFileDocumentClose } from "@/lib/appWorkspaceClose";
import type { TemporaryLinkConfig } from "@/lib/temporaryLink";
import type { Group, SavedConnection } from "@/types/global";

interface AppOverlayDialogsProps {
  t: TFunction;
  showSessionQuickSwitcher: boolean;
  sessionSwitcherScope?: "all" | "connections";
  activeSessionId: string | null;
  quickSwitcherSessions: QuickSwitcherSession[];
  savedConnections: SavedConnection[];
  onCloseSessionQuickSwitcher: () => void;
  onQuickSwitchSession: (sessionId: string) => void;
  onQuickOpenConnection: (connection: SavedConnection) => Promise<void> | void;
  onQuickSwitcherNewSshSession: () => void;
  showTemporarySshLink: boolean;
  onTemporarySshLinkOpenChange: (open: boolean) => void;
  onTemporarySshConnect: (config: TemporaryLinkConfig) => Promise<void> | void;
  externalMatchDialog: ExternalMatchDialogState | null;
  savedGroups: Group[];
  onExternalMatchOpenChange: (open: boolean) => void;
  onExternalMatchConnection: (connection: SavedConnection) => void;
  onExternalMatchTemporary: (config: TemporaryLinkConfig) => void;
  pendingFileDocumentClose: PendingFileDocumentClose | null;
  savingFileDocuments: boolean;
  onPendingFileDocumentCloseOpenChange: (open: boolean) => void;
  onSaveFileDocumentsAndClose: () => Promise<void> | void;
  onDiscardFileDocumentsAndClose: () => void;
  postLoginConfirm: PostLoginConfirmState | null;
  onPostLoginConfirmOpenChange: (open: boolean) => void;
  onPostLoginContinue: () => void;
}

export default function AppOverlayDialogs({
  t,
  showSessionQuickSwitcher,
  sessionSwitcherScope = "all",
  activeSessionId,
  quickSwitcherSessions,
  savedConnections,
  onCloseSessionQuickSwitcher,
  onQuickSwitchSession,
  onQuickOpenConnection,
  onQuickSwitcherNewSshSession,
  showTemporarySshLink,
  onTemporarySshLinkOpenChange,
  onTemporarySshConnect,
  externalMatchDialog,
  savedGroups,
  onExternalMatchOpenChange,
  onExternalMatchConnection,
  onExternalMatchTemporary,
  pendingFileDocumentClose,
  savingFileDocuments,
  onPendingFileDocumentCloseOpenChange,
  onSaveFileDocumentsAndClose,
  onDiscardFileDocumentsAndClose,
  postLoginConfirm,
  onPostLoginConfirmOpenChange,
  onPostLoginContinue,
}: AppOverlayDialogsProps) {
  return (
    <>
      <SessionQuickSwitcher
        open={showSessionQuickSwitcher}
        scope={sessionSwitcherScope}
        activeSessionId={activeSessionId}
        workspaceSessions={quickSwitcherSessions}
        savedConnections={savedConnections}
        onClose={onCloseSessionQuickSwitcher}
        onSelectSession={onQuickSwitchSession}
        onOpenConnection={onQuickOpenConnection}
        onNewSshSession={onQuickSwitcherNewSshSession}
      />
      <TemporarySshLinkDialog
        open={showTemporarySshLink}
        onOpenChange={onTemporarySshLinkOpenChange}
        onConnect={onTemporarySshConnect}
      />
      <ExternalConnectionMatchDialog
        open={externalMatchDialog !== null}
        connections={externalMatchDialog?.connections ?? []}
        groups={savedGroups}
        temporary={externalMatchDialog?.temporary ?? null}
        onOpenChange={onExternalMatchOpenChange}
        onSelectConnection={onExternalMatchConnection}
        onUseTemporary={onExternalMatchTemporary}
      />
      <UnsavedChangesDialog
        open={pendingFileDocumentClose !== null}
        dirtyCount={pendingFileDocumentClose?.paneIds.length ?? 0}
        hasPendingTab={false}
        saving={savingFileDocuments}
        onOpenChange={onPendingFileDocumentCloseOpenChange}
        onSaveAndClose={onSaveFileDocumentsAndClose}
        onDiscard={onDiscardFileDocumentsAndClose}
      />
      <AlertDialog open={postLoginConfirm !== null} onOpenChange={onPostLoginConfirmOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("externalOpen.postLoginConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("externalOpen.postLoginConfirmDescription", {
                name: postLoginConfirm?.connection.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <pre className="max-h-40 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
            {postLoginConfirm?.command ?? ""}
          </pre>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onPostLoginContinue}>
              {t("externalOpen.continueConnection")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
