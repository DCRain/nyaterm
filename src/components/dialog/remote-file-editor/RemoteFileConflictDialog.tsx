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

interface RemoteFileConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscardAndReload: () => void;
  onForceSave: () => void;
}

export default function RemoteFileConflictDialog({
  open,
  onOpenChange,
  onDiscardAndReload,
  onForceSave,
}: RemoteFileConflictDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("fileEditor.conflictTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("fileEditor.conflictDesc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <Button variant="outline" onClick={onDiscardAndReload}>
            {t("fileEditor.discardAndReload")}
          </Button>
          <AlertDialogAction onClick={onForceSave}>{t("fileEditor.forceSave")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
