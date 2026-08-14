import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ResolvedLocalDropPathEntry } from "@/components/panel/file-explorer/model";
import { invoke } from "@/lib/invoke";
import { logger } from "@/lib/logger";
import { useTransfer } from "@/context/TransferContext";
import {
  collectExternalDropAdditionalObjects,
  createExternalFileDropBridgeMessage,
  DRAG_EVENT_CAPTURE_OPTIONS,
  getDragEventPosition,
  getExternalFileDropBridge,
  isDropPositionInsideElement,
  isExternalFileDragEvent,
  logExternalDropBridgeFailure,
  type NativeFileDropEventPayload,
} from "@/lib/nativeFileDrop";

interface UseRdpFileDropParams {
  sessionId: string;
  enabled: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface RdpClipboardFilesPayload {
  sessionId: string;
  paths: string[];
}

interface RdpClipboardTransferPayload {
  id: string;
  sessionId: string;
  status: "started" | "progress" | "completed" | "failed";
  fileName: string;
  direction: "download" | "upload";
  bytesTransferred: number;
  totalSize: number;
  localPath?: string;
  error?: string;
}

export function useRdpFileDrop({ sessionId, enabled, containerRef }: UseRdpFileDropParams) {
  const { t } = useTranslation();
  const {
    upsertExternalTransferProgress,
    completeExternalTransfer,
    failExternalTransfer,
  } = useTransfer();
  const [isExternalDropActive, setIsExternalDropActive] = useState(false);

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const resetExternalDropHover = useCallback(() => {
    setIsExternalDropActive(false);
  }, []);

  const resolveLocalDropPaths = useCallback(async (paths: string[]) => {
    const uniquePaths = Array.from(
      new Set(paths.map((path) => path.trim()).filter((path) => !!path)),
    );
    if (uniquePaths.length === 0) {
      return [];
    }

    return invoke<ResolvedLocalDropPathEntry[]>("resolve_local_drop_paths", {
      paths: uniquePaths,
    });
  }, []);

  const processDropPaths = useCallback(
    async (dropPaths: string[]) => {
      try {
        const resolved = await resolveLocalDropPaths(dropPaths);
        const paths = resolved.map((entry) => entry.path).filter((path) => !!path);
        if (paths.length === 0) {
          logger.warn({
            domain: "ui.error",
            event: "rdp.external_drop_paths_unresolved",
            message: "RDP file drop did not resolve to usable local paths",
            ids: { session_id: sessionId },
            data: { path_count: dropPaths.length },
          });
          toast.error(t("dialog.rdpFileOfferFailed"));
          return;
        }

        const count = await invoke<number>("rdp_offer_local_files", {
          sessionId,
          paths,
          autoPaste: true,
        });
        toast.success(t("dialog.rdpFileOfferQueued", { count }));
      } catch (error) {
        logger.error({
          domain: "ui.error",
          event: "rdp.external_drop_failed",
          message: "Failed to offer local files to RDP clipboard",
          ids: { session_id: sessionId },
          data: { path_count: dropPaths.length },
          error,
        });
        toast.error(t("dialog.rdpFileOfferFailed"));
      }
    },
    [resolveLocalDropPaths, sessionId, t],
  );

  useEffect(() => {
    if (!enabled) {
      resetExternalDropHover();
    }
  }, [enabled, resetExternalDropHover]);

  useEffect(() => {
    let cancelled = false;
    const unlistenPromise = listen<RdpClipboardTransferPayload>(
      `rdp-clipboard-transfer-${sessionId}`,
      (event) => {
        if (cancelled) return;
        const payload = event.payload;
        if (payload.status === "failed") {
          failExternalTransfer(payload.id, payload.error ?? t("dialog.rdpRemoteFilesFailed"));
          return;
        }
        if (payload.status === "completed") {
          upsertExternalTransferProgress({
            id: payload.id,
            sessionId: payload.sessionId,
            fileName: payload.fileName,
            direction: payload.direction,
            bytesTransferred: payload.bytesTransferred,
            totalSize: payload.totalSize,
            localPath: payload.localPath,
            remotePath: "RDP Clipboard",
            source: "rdp-clipboard",
          });
          completeExternalTransfer(payload.id);
          return;
        }
        upsertExternalTransferProgress({
          id: payload.id,
          sessionId: payload.sessionId,
          fileName: payload.fileName,
          direction: payload.direction,
          bytesTransferred: payload.bytesTransferred,
          totalSize: payload.totalSize,
          localPath: payload.localPath,
          remotePath: "RDP Clipboard",
          source: "rdp-clipboard",
        });
      },
    );
    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [
    completeExternalTransfer,
    failExternalTransfer,
    sessionId,
    t,
    upsertExternalTransferProgress,
  ]);

  useEffect(() => {
    let cancelled = false;
    const unlistenPromise = listen<RdpClipboardFilesPayload>(
      `rdp-clipboard-files-${sessionId}`,
      (event) => {
        if (cancelled) return;
        const count = event.payload.paths?.length ?? 0;
        if (count > 0) {
          toast.success(t("dialog.rdpRemoteFilesReady"));
        }
      },
    );
    const unlistenFailedPromise = listen<{ sessionId: string; error?: string }>(
      `rdp-clipboard-files-failed-${sessionId}`,
      () => {
        if (cancelled) return;
        toast.error(t("dialog.rdpRemoteFilesFailed"));
      },
    );
    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
      void unlistenFailedPromise.then((unlisten) => unlisten());
    };
  }, [sessionId, t]);

  useEffect(() => {
    const bridge = getExternalFileDropBridge();
    if (!bridge?.postMessageWithAdditionalObjects) {
      return;
    }

    const updateExternalDropState = (event: DragEvent) => {
      if (!enabledRef.current || !isExternalFileDragEvent(event)) {
        return;
      }

      const isOverDropTarget = isDropPositionInsideElement(
        getDragEventPosition(event),
        containerRef.current,
      );

      if (!isOverDropTarget) {
        resetExternalDropHover();
        return;
      }

      event.preventDefault();
      setIsExternalDropActive(true);
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };

    const handleWindowDragLeave = (event: DragEvent) => {
      if (!enabledRef.current || !isExternalFileDragEvent(event)) {
        return;
      }

      event.preventDefault();

      const leftWindow =
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight;

      if (
        leftWindow ||
        !isDropPositionInsideElement(getDragEventPosition(event), containerRef.current)
      ) {
        resetExternalDropHover();
      }
    };

    const handleWindowDrop = (event: DragEvent) => {
      if (!enabledRef.current || !isExternalFileDragEvent(event)) {
        return;
      }

      const dropPosition = getDragEventPosition(event);
      const isOverDropTarget = isDropPositionInsideElement(dropPosition, containerRef.current);
      resetExternalDropHover();

      if (!isOverDropTarget) {
        return;
      }

      event.preventDefault();

      const dataTransfer = event.dataTransfer;
      if (dataTransfer?.files && dataTransfer.files.length > 0) {
        try {
          bridge.postMessageWithAdditionalObjects(
            createExternalFileDropBridgeMessage(dropPosition),
            dataTransfer.files,
          );
        } catch (error) {
          logExternalDropBridgeFailure(
            "rdp.external_drop_filelist_bridge_failed",
            "Failed to bridge RDP file drop FileList through WebView2 additional objects",
            error,
            {
              session_id: sessionIdRef.current,
              file_count: dataTransfer.files.length,
            },
          );
          toast.error(String(error));
        }
        return;
      }

      void (async () => {
        try {
          const additionalObjects = await collectExternalDropAdditionalObjects(dataTransfer);
          if (additionalObjects.length === 0) {
            toast.error(t("dialog.rdpFileOfferFailed"));
            return;
          }

          bridge.postMessageWithAdditionalObjects(
            createExternalFileDropBridgeMessage(dropPosition),
            additionalObjects,
          );
        } catch (error) {
          logExternalDropBridgeFailure(
            "rdp.external_drop_bridge_failed",
            "Failed to bridge RDP file drop through WebView2 additional objects",
            error,
            {
              session_id: sessionIdRef.current,
            },
          );
          toast.error(String(error));
        }
      })();
    };

    const handleWindowBlur = () => {
      resetExternalDropHover();
    };

    window.addEventListener("dragenter", updateExternalDropState, DRAG_EVENT_CAPTURE_OPTIONS);
    window.addEventListener("dragover", updateExternalDropState, DRAG_EVENT_CAPTURE_OPTIONS);
    window.addEventListener("dragleave", handleWindowDragLeave, DRAG_EVENT_CAPTURE_OPTIONS);
    window.addEventListener("drop", handleWindowDrop, DRAG_EVENT_CAPTURE_OPTIONS);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      resetExternalDropHover();
      window.removeEventListener("dragenter", updateExternalDropState, DRAG_EVENT_CAPTURE_OPTIONS);
      window.removeEventListener("dragover", updateExternalDropState, DRAG_EVENT_CAPTURE_OPTIONS);
      window.removeEventListener("dragleave", handleWindowDragLeave, DRAG_EVENT_CAPTURE_OPTIONS);
      window.removeEventListener("drop", handleWindowDrop, DRAG_EVENT_CAPTURE_OPTIONS);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [containerRef, resetExternalDropHover, t]);

  useEffect(() => {
    const bridge = getExternalFileDropBridge();
    if (!bridge?.postMessageWithAdditionalObjects) {
      return;
    }

    let cancelled = false;

    const unlistenPromise = listen<NativeFileDropEventPayload>("external-file-drop", (event) => {
      if (cancelled) {
        return;
      }

      const payload = event.payload;
      if (payload.kind === "leave") {
        resetExternalDropHover();
        return;
      }

      const isOverDropTarget = isDropPositionInsideElement(payload.position, containerRef.current);
      const isActive = enabledRef.current && isOverDropTarget;

      if (payload.kind === "enter" || payload.kind === "over") {
        setIsExternalDropActive(isActive);
        return;
      }

      if (payload.kind !== "drop") {
        return;
      }

      resetExternalDropHover();

      if (!isActive) {
        return;
      }

      void processDropPaths(payload.paths);
    });

    return () => {
      cancelled = true;
      resetExternalDropHover();
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [containerRef, processDropPaths, resetExternalDropHover]);

  useEffect(() => {
    const bridge = getExternalFileDropBridge();
    if (bridge?.postMessageWithAdditionalObjects) {
      return;
    }

    let cancelled = false;

    const handleWindowBlur = () => {
      resetExternalDropHover();
    };

    window.addEventListener("blur", handleWindowBlur);

    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (cancelled) {
        return;
      }

      const payload = event.payload;
      if (payload.type === "leave") {
        resetExternalDropHover();
        return;
      }

      const isOverDropTarget = isDropPositionInsideElement(payload.position, containerRef.current);
      const isActive = enabledRef.current && isOverDropTarget;

      if (payload.type === "enter" || payload.type === "over") {
        setIsExternalDropActive(isActive);
        return;
      }

      resetExternalDropHover();

      if (!isActive) {
        return;
      }

      void processDropPaths(payload.paths);
    });

    return () => {
      cancelled = true;
      resetExternalDropHover();
      window.removeEventListener("blur", handleWindowBlur);
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [containerRef, processDropPaths, resetExternalDropHover]);

  return { isExternalDropActive };
}
