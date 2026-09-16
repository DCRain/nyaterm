import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { invoke } from "@/lib/invoke";
import type { FileExplorerCustomAction } from "@/types/global";

export interface CustomActionConfirmDialogData {
  level: "warning" | "danger";
  actionName: string;
  entryName: string;
  fullPath: string;
  command: string;
  execute: boolean;
  sessionId: string;
  action: FileExplorerCustomAction;
}

interface CustomActionConfirmDialogProps {
  data: CustomActionConfirmDialogData;
  onClose: () => void;
  onConfirm: (data: CustomActionConfirmDialogData) => void;
}

export default function CustomActionConfirmDialog({
  data,
  onClose,
  onConfirm,
}: CustomActionConfirmDialogProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data.level !== "danger") return;
    setPassword("");
    setPasswordError(false);
    passwordRef.current?.focus();
  }, [data]);

  const handleConfirm = async () => {
    if (data.level === "warning") {
      onConfirm(data);
      return;
    }

    if (!password.trim() || verifying) return;
    setVerifying(true);
    try {
      const ok = await invoke<boolean>("verify_master_password", { password });
      if (!ok) {
        setPasswordError(true);
        setPassword("");
        passwordRef.current?.focus();
        return;
      }
      onConfirm(data);
    } catch {
      setPasswordError(true);
      setPassword("");
      passwordRef.current?.focus();
    } finally {
      setVerifying(false);
    }
  };

  const title =
    data.level === "danger"
      ? t("fileExplorer.customActionConfirmTitleDanger")
      : t("fileExplorer.customActionConfirmTitleWarning");

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-left text-sm text-muted-foreground">
              <p>{t("fileExplorer.customActionConfirmDesc", { name: data.actionName })}</p>
              <p>
                {data.execute
                  ? t("fileExplorer.customActionConfirmExecuteHint")
                  : t("fileExplorer.customActionConfirmPasteHint")}
              </p>
              <div className="space-y-1">
                <div className="text-xs font-medium text-foreground">
                  {t("fileExplorer.customActionConfirmTarget")}
                </div>
                <div className="truncate font-mono text-xs">{data.fullPath || data.entryName}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-foreground">
                  {t("fileExplorer.customActionConfirmCommand")}
                </div>
                <pre className="max-h-32 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap break-all text-foreground">
                  {data.command}
                </pre>
              </div>
              {data.level === "danger" ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground" htmlFor="custom-action-password">
                    {t("fileExplorer.customActionDangerPassword")}
                  </label>
                  <Input
                    id="custom-action-password"
                    ref={passwordRef}
                    type="password"
                    value={password}
                    autoComplete="current-password"
                    disabled={verifying}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (passwordError) setPasswordError(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleConfirm();
                      }
                    }}
                  />
                  {passwordError ? (
                    <p className="text-xs text-destructive">
                      {t("fileExplorer.customActionDangerPasswordError")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={verifying}>{t("dialog.cancel")}</AlertDialogCancel>
          <Button
            variant={data.level === "danger" ? "destructive" : "default"}
            disabled={data.level === "danger" && (!password.trim() || verifying)}
            onClick={() => void handleConfirm()}
          >
            {verifying
              ? t("fileExplorer.customActionVerifyingPassword")
              : t("fileExplorer.customActionConfirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
