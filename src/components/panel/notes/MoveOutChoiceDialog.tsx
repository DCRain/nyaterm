import { Lock, Unlock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type MoveOutChoice = "keep" | "decrypt";

export interface MoveOutChoiceDialogProps {
  open: boolean;
  targetName: string;
  submitting?: boolean;
  onChoose: (choice: MoveOutChoice) => void;
  onCancel: () => void;
}

export default function MoveOutChoiceDialog({
  open,
  targetName,
  submitting = false,
  onChoose,
  onCancel,
}: MoveOutChoiceDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="w-[min(24rem,calc(100vw-2rem))] max-w-none">
        <DialogHeader>
          <DialogTitle className="text-sm">{t("notes.move.outTitle")}</DialogTitle>
          <DialogDescription className="text-xs">
            {t("notes.move.outDescription", { name: targetName })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-1">
          <Button
            type="button"
            variant="outline"
            className="h-auto justify-start gap-2 py-2.5 text-left"
            disabled={submitting}
            onClick={() => onChoose("keep")}
          >
            <Lock className="size-4 shrink-0" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm">{t("notes.move.keepEncrypted")}</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                {t("notes.move.keepEncryptedHint")}
              </span>
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-auto justify-start gap-2 py-2.5 text-left"
            disabled={submitting}
            onClick={() => onChoose("decrypt")}
          >
            <Unlock className="size-4 shrink-0" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm">{t("notes.move.decryptToPlain")}</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                {t("notes.move.decryptToPlainHint")}
              </span>
            </span>
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
