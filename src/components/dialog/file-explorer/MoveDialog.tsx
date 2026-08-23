import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdRefresh } from "react-icons/md";
import { toast } from "sonner";
import {
  buildMoveOperations,
  type FileExplorerBackendKind,
  isMoveToSameDirectory,
  type MoveDialogItem,
  normalizeExplorerPath,
} from "@/components/panel/file-explorer/model";
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
import { getErrorMessage } from "@/lib/errors";
import { invoke } from "@/lib/invoke";

export interface MoveDialogData {
  sessionId: string;
  connectionId?: string;
  backend: FileExplorerBackendKind;
  sourceDirectory: string;
  initialTargetDirectory: string;
  items: MoveDialogItem[];
}

interface MoveDialogProps {
  data: MoveDialogData;
  onClose: () => void;
  onSuccess: (targetDirectory: string) => void;
}

export default function MoveDialog({ data, onClose, onSuccess }: MoveDialogProps) {
  const { t } = useTranslation();
  const [dialogInput, setDialogInput] = useState(data.initialTargetDirectory);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const title =
    data.items.length === 1
      ? t("fileExplorer.moveTo", { name: data.items[0]?.name ?? "" })
      : t("fileExplorer.moveItems", { count: data.items.length });
  const previewItems = data.items.slice(0, 6);
  const remainingItems = data.items.length - previewItems.length;

  useEffect(() => {
    setDialogInput(data.initialTargetDirectory);
  }, [data.initialTargetDirectory]);

  const handleMoveSubmit = async () => {
    const targetDirectory = normalizeExplorerPath(dialogInput, data.backend);
    if (
      !targetDirectory ||
      data.items.length === 0 ||
      isMoveToSameDirectory(data.sourceDirectory, targetDirectory, data.backend)
    ) {
      onClose();
      return;
    }

    try {
      setIsSubmitting(true);
      const operations = buildMoveOperations(data, targetDirectory);
      const results = await Promise.allSettled(
        operations.map((operation) =>
          data.backend === "local"
            ? invoke("rename_local_file", {
                sessionId: data.sessionId,
                oldPath: operation.oldPath,
                newPath: operation.newPath,
              })
            : data.backend === "s3"
              ? invoke("rename_s3_object", {
                  sessionId: data.sessionId,
                  connectionId: data.connectionId,
                  oldPath: operation.oldPath,
                  newPath: operation.newPath,
                })
              : data.backend === "ftp"
                ? invoke("rename_ftp_object", {
                    sessionId: data.sessionId,
                    connectionId: data.connectionId,
                    oldPath: operation.oldPath,
                    newPath: operation.newPath,
                  })
              : data.backend === "webdav"
                ? invoke("rename_webdav_object", {
                    sessionId: data.sessionId,
                    connectionId: data.connectionId,
                    oldPath: operation.oldPath,
                    newPath: operation.newPath,
                  })
              : invoke("rename_remote_file", {
                  sessionId: data.sessionId,
                  oldPath: operation.oldPath,
                  newPath: operation.newPath,
                  oldRawPathToken: operation.oldRawPathToken,
                }),
        ),
      );
      const failedCount = results.filter(
        (result) => result.status === "rejected",
      ).length;
      const successCount = results.length - failedCount;

      if (successCount > 0) {
        onSuccess(targetDirectory);
      }

      if (failedCount > 0) {
        toast.error(
          failedCount === 1
            ? t("fileExplorer.moveFailedItem")
            : t("fileExplorer.moveFailedCount", { count: failedCount }),
        );
      }

      onClose();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog disablePointerDismissal open onOpenChange={(v) => !v && !isSubmitting && onClose()}>
      <DialogContent className="w-[min(24rem,calc(100vw-2rem))] sm:max-w-96">
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle className="w-full text-sm truncate" title={title}>
            {title}
          </DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {data.items.length > 1 && (
            <div
              className="terminal-scroll max-h-32 overflow-y-auto rounded-md border px-2 py-1.5 text-xs"
              style={{
                borderColor: "var(--df-border)",
                color: "var(--df-text-dimmed)",
              }}
            >
              {previewItems.map((item) => (
                <div key={item.oldPath} className="truncate py-0.5" title={item.oldPath}>
                  {item.name}
                </div>
              ))}
              {remainingItems > 0 && (
                <div className="pt-1" style={{ color: "var(--df-text)" }}>
                  {t("fileExplorer.moreItems", { count: remainingItems })}
                </div>
              )}
            </div>
          )}
          <Label className="text-xs" htmlFor="file-explorer-move-target-directory">
            {t("fileExplorer.targetDirectory")}
          </Label>
          <Input
            id="file-explorer-move-target-directory"
            className="text-sm"
            value={dialogInput}
            onChange={(e) => setDialogInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !isSubmitting && handleMoveSubmit()}
            disabled={isSubmitting}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
            {t("dialog.cancel")}
          </Button>
          <Button size="sm" onClick={handleMoveSubmit} disabled={isSubmitting}>
            {isSubmitting && <MdRefresh className="text-[0.875rem] animate-spin" />}
            {t("fileExplorer.cmMove")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
