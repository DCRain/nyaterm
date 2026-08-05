import { emit } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ResolvedLocalDropPathEntry } from "@/components/panel/file-explorer/model";
import { useTerminalFileDrop } from "@/hooks/useTerminalFileDrop";
import {
  formatExplorerPathsForTerminal,
  hasExplorerPathDrag,
  readExplorerPathDragData,
} from "@/lib/explorerPathDrag";
import { invoke } from "@/lib/invoke";
import { logger } from "@/lib/logger";
import {
  DRAG_EVENT_CAPTURE_OPTIONS,
  getDragEventPosition,
  isDropPositionInsideElement,
} from "@/lib/nativeFileDrop";
import { sendSessionInput } from "@/lib/sessionInput";
import { getTerminalDropOverlayCopy, handleTerminalFileDrop } from "@/lib/terminalFileDrop";
import type { SessionType } from "@/types/global";

interface UseTerminalExternalDropParams {
  sessionId: string;
  sessionType: SessionType;
  visible: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  t: (key: string) => string;
  duplicateStrategy: string;
}

export function useTerminalExternalDrop({
  sessionId,
  sessionType,
  visible,
  containerRef,
  t,
  duplicateStrategy,
}: UseTerminalExternalDropParams) {
  const [isExternalDropActive, setIsExternalDropActive] = useState(false);
  const [isExplorerPathDropActive, setIsExplorerPathDropActive] = useState(false);

  const resetExternalDropHover = useCallback(() => {
    setIsExternalDropActive(false);
  }, []);

  const resetExplorerPathDropHover = useCallback(() => {
    setIsExplorerPathDropActive(false);
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

  const processTerminalDropPaths = useCallback(
    async (dropPaths: string[]) => {
      try {
        const resolvedLocalEntries = await resolveLocalDropPaths(dropPaths);
        if (resolvedLocalEntries.length === 0) {
          logger.warn({
            domain: "ui.error",
            event: "terminal.external_drop_paths_unresolved",
            message: "Native terminal drop did not resolve to usable local paths",
            ids: { session_id: sessionId },
            data: { path_count: dropPaths.length },
          });
          toast.error(t("terminal.dropPathsRequired"));
          return;
        }

        await handleTerminalFileDrop({
          sessionId,
          sessionType,
          entries: resolvedLocalEntries,
          t,
          duplicateStrategy,
        });
      } catch (error) {
        logger.error({
          domain: "ui.error",
          event: "terminal.external_drop_failed",
          message: "Failed to process terminal file drop",
          ids: { session_id: sessionId },
          data: { path_count: dropPaths.length },
          error,
        });
        toast.error(String(error));
      }
    },
    [duplicateStrategy, resolveLocalDropPaths, sessionId, sessionType, t],
  );

  useTerminalFileDrop({
    sessionId,
    sessionType,
    enabled: visible,
    containerRef,
    resetExternalDropHover,
    setIsExternalDropActive,
    processDropPaths: processTerminalDropPaths,
    externalDropPathsRequiredMessage: t("terminal.dropPathsRequired"),
  });

  useEffect(() => {
    if (!visible) {
      resetExplorerPathDropHover();
    }
  }, [resetExplorerPathDropHover, visible]);

  useEffect(() => {
    const updateExplorerDropState = (event: DragEvent) => {
      if (!visible || !hasExplorerPathDrag(event.dataTransfer)) {
        return;
      }

      const isOverDropTarget = isDropPositionInsideElement(
        getDragEventPosition(event),
        containerRef.current,
      );
      if (!isOverDropTarget) {
        resetExplorerPathDropHover();
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      setIsExplorerPathDropActive(true);
    };

    const handleWindowDragLeave = (event: DragEvent) => {
      if (!visible || !hasExplorerPathDrag(event.dataTransfer)) {
        return;
      }

      const leftWindow =
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight;

      if (
        leftWindow ||
        !isDropPositionInsideElement(getDragEventPosition(event), containerRef.current)
      ) {
        resetExplorerPathDropHover();
      }
    };

    const handleWindowDrop = (event: DragEvent) => {
      if (!visible || !hasExplorerPathDrag(event.dataTransfer)) {
        return;
      }

      const isOverDropTarget = isDropPositionInsideElement(
        getDragEventPosition(event),
        containerRef.current,
      );
      resetExplorerPathDropHover();
      if (!isOverDropTarget) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const payload = readExplorerPathDragData(event.dataTransfer);
      if (!payload) {
        toast.error(t("terminal.dropPathsRequired"));
        return;
      }

      const text = formatExplorerPathsForTerminal(payload.paths, payload.backend);
      if (!text) {
        return;
      }

      void sendSessionInput(sessionId, text)
        .then(() => emit(`focus-terminal-${sessionId}`))
        .catch((error) => {
          logger.error({
            domain: "ui.error",
            event: "terminal.explorer_path_drop_failed",
            message: "Failed to paste explorer paths into terminal",
            ids: { session_id: sessionId },
            data: { path_count: payload.paths.length },
            error,
          });
          toast.error(String(error));
        });
    };

    const handleWindowBlur = () => {
      resetExplorerPathDropHover();
    };

    window.addEventListener("dragenter", updateExplorerDropState, DRAG_EVENT_CAPTURE_OPTIONS);
    window.addEventListener("dragover", updateExplorerDropState, DRAG_EVENT_CAPTURE_OPTIONS);
    window.addEventListener("dragleave", handleWindowDragLeave, DRAG_EVENT_CAPTURE_OPTIONS);
    window.addEventListener("drop", handleWindowDrop, DRAG_EVENT_CAPTURE_OPTIONS);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      resetExplorerPathDropHover();
      window.removeEventListener("dragenter", updateExplorerDropState, DRAG_EVENT_CAPTURE_OPTIONS);
      window.removeEventListener("dragover", updateExplorerDropState, DRAG_EVENT_CAPTURE_OPTIONS);
      window.removeEventListener("dragleave", handleWindowDragLeave, DRAG_EVENT_CAPTURE_OPTIONS);
      window.removeEventListener("drop", handleWindowDrop, DRAG_EVENT_CAPTURE_OPTIONS);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [containerRef, resetExplorerPathDropHover, sessionId, t, visible]);

  const dropOverlayCopy = useMemo(
    () =>
      getTerminalDropOverlayCopy(sessionType, t, {
        source: isExplorerPathDropActive ? "explorer" : "external",
      }),
    [isExplorerPathDropActive, sessionType, t],
  );

  return {
    isExternalDropActive: isExternalDropActive || isExplorerPathDropActive,
    dropOverlayCopy,
  };
}
