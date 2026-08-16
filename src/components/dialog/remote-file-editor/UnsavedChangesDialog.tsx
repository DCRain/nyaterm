import { useTranslation } from "react-i18next";
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
import { Button } from "@/components/ui/button";

interface UnsavedChangesDialogProps {
  dirtyCount: number;
  hasPendingTab: boolean;
  open: boolean;
  saving: boolean;
  onDiscard: () => void;
  onOpenChange: (open: boolean) => void;
  onSaveAndClose: () => Promise<void> | void;
}

export default function UnsavedChangesDialog({
  dirtyCount,
  hasPendingTab,
  open,
  saving,
  onDiscard,
  onOpenChange,
  onSaveAndClose,
}: UnsavedChangesDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("fileEditor.unsavedTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {hasPendingTab
              ? t("fileEditor.unsavedDesc")
              : t("fileEditor.unsavedFilesDesc", { count: dirtyCount })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => {
              void onSaveAndClose();
            }}
          >
            {hasPendingTab ? t("fileEditor.saveAndClose") : t("fileEditor.saveAllAndClose")}
          </Button>
          <AlertDialogAction variant="destructive" onClick={onDiscard}>
            {t("fileEditor.discard")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
