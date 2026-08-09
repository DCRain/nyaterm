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

interface RestoreBuiltinQuickCommandsDialogProps {
  open: boolean;
  restoring: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function RestoreBuiltinQuickCommandsDialog({
  open,
  restoring,
  onCancel,
  onConfirm,
}: RestoreBuiltinQuickCommandsDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !restoring) onCancel();
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("quickCommands.restoreBuiltins")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("quickCommands.restoreBuiltinsConfirm")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={restoring}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={restoring}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {restoring
              ? t("quickCommands.restoringBuiltins")
              : t("quickCommands.restoreBuiltins")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
