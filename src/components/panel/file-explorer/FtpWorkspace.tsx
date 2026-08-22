import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import ResizeHandle from "@/components/layout/ResizeHandle";
import { useTransfer } from "@/context/TransferContext";
import type { SessionPane } from "@/types/global";
import {
  type FileExplorerCopyEntry,
  FileExplorerPane,
  type FileExplorerPaneEndpoint,
} from "./FileExplorer";
import FileTransfer from "./FileTransfer";

const DEFAULT_LOCAL_RATIO = 0.5;
const MIN_PANE_RATIO = 0.22;
const MAX_PANE_RATIO = 0.78;

interface FtpWorkspaceProps {
  pane: SessionPane;
  visible: boolean;
}

/** Main-area dual-pane FTP: local left, remote right. No terminal session. */
export default function FtpWorkspace({ pane, visible }: FtpWorkspaceProps) {
  const { t } = useTranslation();
  const { enqueueCopies } = useTransfer();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [localRatio, setLocalRatio] = useState(DEFAULT_LOCAL_RATIO);
  const [localEndpoint, setLocalEndpoint] = useState<FileExplorerPaneEndpoint | null>(null);
  const [remoteEndpoint, setRemoteEndpoint] = useState<FileExplorerPaneEndpoint | null>(null);
  const [transferHeight, setTransferHeight] = useState(160);

  const sessionId = pane.connecting || pane.connectError ? null : pane.sessionId;
  const connectionId = pane.connectionId ?? null;

  const enqueuePaneCopies = useCallback(
    (
      source: FileExplorerPaneEndpoint,
      target: FileExplorerPaneEndpoint,
      entries: FileExplorerCopyEntry[],
    ) => {
      if (!target.currentPath || entries.length === 0) return;
      enqueueCopies(
        entries.map((entry) => ({
          fileName: entry.name,
          kind: entry.isDirectory ? "directory" : "file",
          source: {
            sessionId: source.sessionId,
            kind: source.kind,
            path: entry.path,
          },
          target: {
            sessionId: target.sessionId,
            kind: target.kind,
            path: target.currentPath,
          },
        })),
      );
      toast.success(t("fileExplorer.copyQueued", { count: entries.length }));
    },
    [enqueueCopies, t],
  );

  const handleSplitResize = useCallback((delta: number) => {
    const width = containerRef.current?.clientWidth ?? 0;
    if (width <= 0) return;
    setLocalRatio((prev) =>
      Math.min(MAX_PANE_RATIO, Math.max(MIN_PANE_RATIO, prev + delta / width)),
    );
  }, []);

  const handleTransferResize = useCallback((delta: number) => {
    setTransferHeight((prev) => Math.min(360, Math.max(100, prev - delta)));
  }, []);

  if (pane.connecting) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-3 text-sm"
        style={{ color: "var(--df-text-dimmed)", backgroundColor: "var(--df-bg)" }}
      >
        <svg
          aria-hidden="true"
          className="h-6 w-6 animate-spin"
          style={{ color: "var(--df-primary)" }}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <span className="max-w-[16rem] truncate px-4 text-center">{pane.name}</span>
      </div>
    );
  }

  if (pane.connectError) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center text-sm"
        style={{ color: "var(--df-text-dimmed)", backgroundColor: "var(--df-bg)" }}
        aria-live="polite"
      >
        <span className="font-medium" style={{ color: "var(--df-text)" }}>
          {t("terminal.connectionFailed")}
        </span>
        <span className="max-w-md break-words">{pane.connectError}</span>
      </div>
    );
  }

  if (!visible || !sessionId) {
    return <div className="h-full w-full" style={{ backgroundColor: "var(--df-bg)" }} />;
  }

  return (
    <div
      className="flex h-full w-full min-h-0 min-w-0 flex-col"
      style={{ backgroundColor: "var(--df-bg)" }}
    >
      <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 flex-row">
        <div
          className="min-h-0 min-w-0 overflow-hidden border-r"
          style={{
            flexBasis: `${localRatio * 100}%`,
            flexGrow: 0,
            flexShrink: 0,
            borderColor: "var(--df-border)",
          }}
        >
          <FileExplorerPane
            activeSessionId={sessionId}
            activeSessionType="FTP"
            activeConnectionId={null}
            activeSessionName={pane.name}
            forceBackend="local"
            headerMeta={t("ftpWorkspace.local")}
            showTerminalActions={false}
            peerTransferAction="upload"
            peerEndpoint={remoteEndpoint}
            onDirectoryStateChange={setLocalEndpoint}
            onSendEntries={(source, entries) => {
              if (remoteEndpoint) {
                enqueuePaneCopies(source, remoteEndpoint, entries);
              }
            }}
            onReceiveEntries={(source, entries) => {
              if (localEndpoint) {
                enqueuePaneCopies(source, localEndpoint, entries);
              }
            }}
          />
        </div>
        <ResizeHandle direction="horizontal" onResize={handleSplitResize} />
        <div
          className="min-h-0 min-w-0 flex-1 overflow-hidden"
          style={{
            flexBasis: `${(1 - localRatio) * 100}%`,
            flexGrow: 1,
            flexShrink: 1,
          }}
        >
          <FileExplorerPane
            activeSessionId={sessionId}
            activeSessionType="FTP"
            activeConnectionId={connectionId}
            activeSessionName={pane.name}
            forceBackend="ftp"
            headerMeta={t("ftpWorkspace.remote")}
            showTerminalActions={false}
            peerTransferAction="download"
            peerEndpoint={localEndpoint}
            onDirectoryStateChange={setRemoteEndpoint}
            onSendEntries={(source, entries) => {
              if (localEndpoint) {
                enqueuePaneCopies(source, localEndpoint, entries);
              }
            }}
            onReceiveEntries={(source, entries) => {
              if (remoteEndpoint) {
                enqueuePaneCopies(source, remoteEndpoint, entries);
              }
            }}
          />
        </div>
      </div>
      <ResizeHandle direction="vertical" onResize={handleTransferResize} />
      <div className="min-h-0 shrink-0 overflow-hidden" style={{ height: transferHeight }}>
        <FileTransfer activeSessionId={sessionId} />
      </div>
    </div>
  );
}
