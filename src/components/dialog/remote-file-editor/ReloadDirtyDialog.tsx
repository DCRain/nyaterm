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

interface ReloadDirtyDialogProps {
  open: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export default function ReloadDirtyDialog({
  open,
  onConfirm,
  onOpenChange,
}: ReloadDirtyDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("fileEditor.reloadDirtyTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("fileEditor.reloadDirtyDesc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {t("fileEditor.discardAndReload")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
