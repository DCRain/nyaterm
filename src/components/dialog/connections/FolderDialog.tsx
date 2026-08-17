import { useEffect, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";

interface FolderDialogProps {
  open: boolean;
  isEditing: boolean;
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export default function FolderDialog({
  open,
  isEditing,
  name,
  onNameChange,
  onSubmit,
  onCancel,
}: FolderDialogProps) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitInFlightRef = useRef(false);

  useEffect(() => {
    if (!open) {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }, [open]);

  const handleSubmit = () => {
    if (!name.trim() || submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setIsSubmitting(true);
    onSubmit();
  };

  return (
    <Dialog
      disablePointerDismissal
      open={open}
      onOpenChange={(v) => !v && !submitInFlightRef.current && onCancel()}
    >
      <DialogContent showCloseButton={false} className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {isEditing ? t("savedConnections.renameFolder") : t("savedConnections.newFolder")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isEditing ? t("savedConnections.renameFolder") : t("savedConnections.newFolder")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            className="text-sm"
            placeholder={t("savedConnections.folderNamePlaceholder")}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              handleSubmit();
            }}
            disabled={isSubmitting}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={isSubmitting}>
            {t("dialog.cancel")}
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={isSubmitting || !name.trim()}>
            {t("dialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
