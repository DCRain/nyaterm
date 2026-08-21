import { Eye, EyeOff, Lock } from "lucide-react";
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
import { Label } from "@/components/ui/label";

export type NotePasswordMode = "unlock" | "encrypt" | "decrypt" | "change";

export interface NotePasswordDialogProps {
  open: boolean;
  mode: NotePasswordMode;
  targetName: string;
  error?: string;
  submitting?: boolean;
  onSubmit: (password: string, newPassword?: string) => void;
  onCancel: () => void;
}

export default function NotePasswordDialog({
  open,
  mode,
  targetName,
  error,
  submitting = false,
  onSubmit,
  onCancel,
}: NotePasswordDialogProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setConfirmPassword("");
    setNewPassword("");
    setShowPassword(false);
    setLocalError("");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open, mode, targetName]);

  const titleKey =
    mode === "unlock"
      ? "notes.password.unlockTitle"
      : mode === "encrypt"
        ? "notes.password.encryptTitle"
        : mode === "decrypt"
          ? "notes.password.decryptTitle"
          : "notes.password.changeTitle";

  const descriptionKey =
    mode === "unlock"
      ? "notes.password.unlockDescription"
      : mode === "encrypt"
        ? "notes.password.encryptDescription"
        : mode === "decrypt"
          ? "notes.password.decryptDescription"
          : "notes.password.changeDescription";

  const handleSubmit = () => {
    if (submitting) return;
    if (!password.trim()) {
      setLocalError(t("notes.password.required"));
      return;
    }
    if (mode === "encrypt") {
      if (password !== confirmPassword) {
        setLocalError(t("notes.password.mismatch"));
        return;
      }
      if (password.length < 4) {
        setLocalError(t("notes.password.tooShort"));
        return;
      }
      onSubmit(password);
      return;
    }
    if (mode === "change") {
      if (!newPassword.trim()) {
        setLocalError(t("notes.password.required"));
        return;
      }
      if (newPassword !== confirmPassword) {
        setLocalError(t("notes.password.mismatch"));
        return;
      }
      if (newPassword.length < 4) {
        setLocalError(t("notes.password.tooShort"));
        return;
      }
      onSubmit(password, newPassword);
      return;
    }
    onSubmit(password);
  };

  const displayError = localError || error;

  return (
    <Dialog
      disablePointerDismissal
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        className="w-[min(24rem,calc(100vw-2rem))] max-w-none"
        onKeyDown={(event) => {
          if (event.key === "Enter") handleSubmit();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Lock className="size-4" />
            {t(titleKey)}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t(descriptionKey, { name: targetName })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label htmlFor="note-password" className="text-xs">
              {mode === "change"
                ? t("notes.password.currentPassword")
                : t("notes.password.enterPassword")}
            </Label>
            <div className="relative">
              <Input
                ref={inputRef}
                id="note-password"
                type={showPassword ? "text" : "password"}
                value={password}
                autoComplete="off"
                onChange={(event) => {
                  setPassword(event.target.value);
                  setLocalError("");
                }}
                className="pr-9"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? t("notes.password.hide") : t("notes.password.show")}
              >
                {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </Button>
            </div>
          </div>

          {mode === "change" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="note-new-password" className="text-xs">
                {t("notes.password.newPassword")}
              </Label>
              <Input
                id="note-new-password"
                type={showPassword ? "text" : "password"}
                value={newPassword}
                autoComplete="off"
                onChange={(event) => {
                  setNewPassword(event.target.value);
                  setLocalError("");
                }}
              />
            </div>
          ) : null}

          {mode === "encrypt" || mode === "change" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="note-confirm-password" className="text-xs">
                {t("notes.password.confirmPassword")}
              </Label>
              <Input
                id="note-confirm-password"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                autoComplete="off"
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  setLocalError("");
                }}
              />
            </div>
          ) : null}

          {mode === "encrypt" ? (
            <p className="text-[11px] text-muted-foreground">{t("notes.password.lostWarning")}</p>
          ) : null}

          {displayError ? (
            <p className="text-xs text-destructive">{displayError}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting ? t("common.loading") : t("common.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
