import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdExpandMore } from "react-icons/md";
import { toast } from "sonner";
import ResizeHandle from "@/components/layout/ResizeHandle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/context/AppContext";
import { useTransfer } from "@/context/TransferContext";
import { getErrorMessage } from "@/lib/errors";
import { invoke } from "@/lib/invoke";
import { openSshTerminalAtPath } from "@/lib/openSshTerminalAtPath";
import type {
  SavedConnection,
  SessionInfo,
  SessionPane,
  WorkspaceSessionType,
} from "@/types/global";
import {
  type FileExplorerCopyEntry,
  FileExplorerPane,
  type FileExplorerPaneEndpoint,
} from "./FileExplorer";
import FileTransfer from "./FileTransfer";
import type { FileExplorerBackendKind } from "./model";

const DEFAULT_LOCAL_RATIO = 0.5;
const MIN_PANE_RATIO = 0.22;
const MAX_PANE_RATIO = 0.78;

type LeftSource =
  | { kind: "local" }
  | {
      kind: "connection";
      connection: SavedConnection;
      backend: Exclude<FileExplorerBackendKind, "local">;
      sessionId: string;
      sessionType: WorkspaceSessionType;
      ownsSession: boolean;
    };

interface DualPaneFileWorkspaceProps {
  pane: SessionPane;
  visible: boolean;
  rightBackend: Exclude<FileExplorerBackendKind, "local">;
  rightSessionType: WorkspaceSessionType;
  rightHeader: string;
}

function isBrowsableSavedConnection(connection: SavedConnection) {
  if (connection.type === "ftp" || connection.type === "s3" || connection.type === "webdav") {
    return true;
  }
  return connection.type === "ssh" && connection.sftp?.enabled !== false;
}

function storageSessionId(connection: SavedConnection) {
  if (connection.type === "s3") return `s3:${connection.id}`;
  if (connection.type === "ftp") return `ftp:${connection.id}`;
  return `webdav:${connection.id}`;
}

function connectionBackend(
  connection: SavedConnection,
): Exclude<FileExplorerBackendKind, "local"> | null {
  if (connection.type === "ssh") return "remote";
  if (connection.type === "ftp") return "ftp";
  if (connection.type === "s3") return "s3";
  if (connection.type === "webdav") return "webdav";
  return null;
}

function connectionSessionType(connection: SavedConnection): WorkspaceSessionType | null {
  if (connection.type === "ssh") return "SSH";
  if (connection.type === "ftp") return "FTP";
  if (connection.type === "s3") return "S3";
  if (connection.type === "webdav") return "WebDAV";
  return null;
}

function typeLabelKey(type: SavedConnection["type"]) {
  if (type === "ssh") return "fileExplorer.leftSourceSftp";
  if (type === "ftp") return "fileExplorer.leftSourceFtp";
  if (type === "s3") return "fileExplorer.leftSourceS3";
  if (type === "webdav") return "fileExplorer.leftSourceWebDav";
  return "fileExplorer.leftSourceLocal";
}

async function findReusableSshSession(connectionId: string) {
  const sessions = await invoke<SessionInfo[]>("list_sessions");
  return (
    sessions.find(
      (session) =>
        session.connected &&
        session.session_type === "SSH" &&
        session.connection_id === connectionId &&
        session.remote_file_browser_enabled,
    )?.id ?? null
  );
}

export default function DualPaneFileWorkspace({
  pane,
  visible,
  rightBackend,
  rightSessionType,
  rightHeader,
}: DualPaneFileWorkspaceProps) {
  const { t } = useTranslation();
  const { savedConnections } = useApp();
  const { enqueueCopies } = useTransfer();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ownedSessionRef = useRef<string | null>(null);
  const [localRatio, setLocalRatio] = useState(DEFAULT_LOCAL_RATIO);
  const [leftEndpoint, setLeftEndpoint] = useState<FileExplorerPaneEndpoint | null>(null);
  const [rightEndpoint, setRightEndpoint] = useState<FileExplorerPaneEndpoint | null>(null);
  const [transferHeight, setTransferHeight] = useState(160);
  const [leftSource, setLeftSource] = useState<LeftSource>({ kind: "local" });
  const [leftConnecting, setLeftConnecting] = useState(false);

  const sessionId = pane.connecting || pane.connectError ? null : pane.sessionId;
  const connectionId = pane.connectionId ?? null;

  const closeOwnedSession = useCallback(async () => {
    const owned = ownedSessionRef.current;
    if (!owned) return;
    ownedSessionRef.current = null;
    await invoke("close_session", { sessionId: owned }).catch(() => undefined);
  }, []);

  useEffect(() => {
    return () => {
      void closeOwnedSession();
    };
  }, [closeOwnedSession]);

  const pickerConnections = useMemo(
    () =>
      savedConnections
        .filter(isBrowsableSavedConnection)
        .filter((connection) => connection.id !== connectionId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [connectionId, savedConnections],
  );

  const groupedConnections = useMemo(() => {
    const groups: Array<{ type: SavedConnection["type"]; items: SavedConnection[] }> = [
      { type: "ssh", items: [] },
      { type: "ftp", items: [] },
      { type: "s3", items: [] },
      { type: "webdav", items: [] },
    ];
    for (const connection of pickerConnections) {
      const group = groups.find((item) => item.type === connection.type);
      group?.items.push(connection);
    }
    return groups.filter((group) => group.items.length > 0);
  }, [pickerConnections]);

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

  const resetToLocal = useCallback(async () => {
    await closeOwnedSession();
    setLeftEndpoint(null);
    setLeftSource({ kind: "local" });
  }, [closeOwnedSession]);

  const selectConnection = useCallback(
    async (connection: SavedConnection) => {
      const backend = connectionBackend(connection);
      const sessionType = connectionSessionType(connection);
      if (!backend || !sessionType) return;

      setLeftConnecting(true);
      try {
        await closeOwnedSession();
        setLeftEndpoint(null);

        if (connection.type === "ssh") {
          const reused = await findReusableSshSession(connection.id);
          let nextSessionId = reused;
          let ownsSession = false;
          if (!nextSessionId) {
            nextSessionId = await invoke<string>("create_ssh_session", {
              connectionId: connection.id,
              createRequestId: crypto.randomUUID(),
            });
            ownsSession = true;
            ownedSessionRef.current = nextSessionId;
          }
          setLeftSource({
            kind: "connection",
            connection,
            backend,
            sessionId: nextSessionId,
            sessionType,
            ownsSession,
          });
          return;
        }

        setLeftSource({
          kind: "connection",
          connection,
          backend,
          sessionId: storageSessionId(connection),
          sessionType,
          ownsSession: false,
        });
      } catch (error) {
        await resetToLocal();
        toast.error(t("fileExplorer.leftSourceSwitchFailed", { error: getErrorMessage(error) }));
      } finally {
        setLeftConnecting(false);
      }
    },
    [closeOwnedSession, resetToLocal, t],
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

  const leftIsLocal = leftSource.kind === "local";
  const leftSessionId = leftSource.kind === "local" ? sessionId : leftSource.sessionId;
  const leftSessionType = leftSource.kind === "local" ? rightSessionType : leftSource.sessionType;
  const leftBackend: FileExplorerBackendKind =
    leftSource.kind === "local" ? "local" : leftSource.backend;
  const leftConnectionId = leftSource.kind === "local" ? null : leftSource.connection.id;
  const leftLabel =
    leftSource.kind === "local" ? t("fileExplorer.leftSourceLocal") : leftSource.connection.name;
  const leftPeerAction = leftIsLocal ? "upload" : "copy";
  const rightPeerAction = leftIsLocal ? "download" : "copy";

  const leftHeader = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex max-w-full min-w-0 items-center gap-0.5 rounded-sm text-left outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          style={{ color: "var(--df-text-dimmed)" }}
          aria-label={t("fileExplorer.leftSourcePicker")}
        >
          <span className="min-w-0 truncate">{leftLabel}</span>
          <MdExpandMore className="h-3.5 w-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuItem
          onSelect={() => {
            void resetToLocal();
          }}
        >
          {t("fileExplorer.leftSourceLocal")}
        </DropdownMenuItem>
        {groupedConnections.length > 0 ? <DropdownMenuSeparator /> : null}
        {groupedConnections.map((group) => (
          <DropdownMenuGroup key={group.type}>
            <DropdownMenuLabel className="text-[0.625rem] uppercase tracking-wider">
              {t(typeLabelKey(group.type))}
            </DropdownMenuLabel>
            {group.items.map((connection) => (
              <DropdownMenuItem
                key={connection.id}
                onSelect={() => {
                  void selectConnection(connection);
                }}
              >
                {connection.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

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
          {leftConnecting || !leftSessionId ? (
            <div
              className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs"
              style={{ color: "var(--df-text-dimmed)" }}
            >
              {t("fileExplorer.leftSourceConnecting")}
            </div>
          ) : (
            <FileExplorerPane
              key={`${leftBackend}:${leftSessionId}`}
              activeSessionId={leftSessionId}
              activeSessionType={leftSessionType}
              activeConnectionId={leftConnectionId}
              activeSessionName={leftLabel}
              forceBackend={leftBackend}
              headerMeta={leftHeader}
              showTerminalActions={false}
              peerTransferAction={leftPeerAction}
              peerEndpoint={rightEndpoint}
              onOpenTerminalHere={
                leftSource.kind === "connection" &&
                leftSource.backend === "remote" &&
                leftConnectionId
                  ? (directoryPath) => {
                      openSshTerminalAtPath(leftConnectionId, directoryPath);
                    }
                  : undefined
              }
              onDirectoryStateChange={setLeftEndpoint}
              onSendEntries={(source, entries) => {
                if (rightEndpoint) {
                  enqueuePaneCopies(source, rightEndpoint, entries);
                }
              }}
              onReceiveEntries={(source, entries) => {
                if (leftEndpoint) {
                  enqueuePaneCopies(source, leftEndpoint, entries);
                }
              }}
            />
          )}
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
            activeSessionType={rightSessionType}
            activeConnectionId={connectionId}
            activeSessionName={pane.name}
            forceBackend={rightBackend}
            headerMeta={rightHeader}
            showTerminalActions={false}
            peerTransferAction={rightPeerAction}
            peerEndpoint={leftEndpoint}
            onOpenTerminalHere={
              rightBackend === "remote" && connectionId
                ? (directoryPath) => {
                    openSshTerminalAtPath(connectionId, directoryPath);
                  }
                : undefined
            }
            onDirectoryStateChange={setRightEndpoint}
            onSendEntries={(source, entries) => {
              if (leftEndpoint) {
                enqueuePaneCopies(source, leftEndpoint, entries);
              }
            }}
            onReceiveEntries={(source, entries) => {
              if (rightEndpoint) {
                enqueuePaneCopies(source, rightEndpoint, entries);
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
