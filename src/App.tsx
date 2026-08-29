import { listen } from "@tauri-apps/api/event";
import { downloadDir } from "@tauri-apps/api/path";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import AppLayout from "./components/app/AppLayout";
import AppPanelContent from "./components/app/AppPanelContent";
import ActivityBarResetDialog from "./components/dialog/app/ActivityBarResetDialog";
import AppOverlayDialogs from "./components/dialog/app/AppOverlayDialogs";
import type { HostKeyVerifyRequest } from "./components/dialog/connections/HostKeyVerifyDialog";
import type { OtpRequest } from "./components/dialog/connections/OtpDialog";
import type { FtpCertificateVerifyRequest } from "./components/dialog/connections/FtpCertificateVerifyDialog";
import type { RdpCertificateVerifyRequest } from "./components/dialog/connections/RdpCertificateVerifyDialog";
import RemoteDesktopClientMissingDialog from "./components/dialog/connections/RemoteDesktopClientMissingDialog";
import type { SshAgentAuthRequest } from "./components/dialog/connections/SshAgentAuthDialog";
import type { SshAuthRequest } from "./components/dialog/connections/SshAuthDialog";
import type { DockerSudoPasswordRequest } from "./components/dialog/docker/DockerSudoPasswordDialog";
import LocalShellPickerDialog, {
  type LocalShellSelection,
} from "./components/dialog/terminal/LocalShellPickerDialog";
import type { QuickSwitcherSession } from "./components/dialog/terminal/SessionQuickSwitcherDialog";
import { clearDirectoryChildrenCacheForSession } from "./components/panel/file-explorer/FileExplorerPathBar";
import { clearFileExplorerSessionCacheForSession } from "./components/panel/file-explorer/model";

import { useApp } from "./context/AppContext";
import { TransferProvider } from "./context/TransferContext";
import { useActivityBarController } from "./hooks/useActivityBarController";
import { type ExternalOpenRequest, useExternalOpenRequests } from "./hooks/useExternalOpenRequests";
import { useFileDocumentCloseGuard } from "./hooks/useFileDocumentCloseGuard";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useIdleLock } from "./hooks/useIdleLock";
import { useMacSelectionGuard } from "./hooks/useMacSelectionGuard";
import { useModalChildWindows } from "./hooks/useModalChildWindows";
import { useRemoteGpuOverview } from "./hooks/useRemoteGpuOverview";
import { useRemoteNpuOverview } from "./hooks/useRemoteNpuOverview";
import { useRemoteStats } from "./hooks/useRemoteStats";
import { useSecurityPromptQueue } from "./hooks/useSecurityPromptQueue";
import { useSessionRuntimeState } from "./hooks/useSessionRuntimeState";
import { resolveDisplayKeys } from "./hooks/useShortcutMap";
import { useTerminalZoom } from "./hooks/useTerminalZoom";
import { useTabStatusIndicators } from "./hooks/useUnreadTabs";
function storageWorkspaceInvalidate(
  sessionId: string,
): { command: string; connectionId: string } | null {
  if (sessionId.startsWith("webdav:")) {
    return {
      command: "invalidate_webdav_connection",
      connectionId: sessionId.slice("webdav:".length),
    };
  }
  if (sessionId.startsWith("ftp:")) {
    return {
      command: "invalidate_ftp_connection",
      connectionId: sessionId.slice("ftp:".length),
    };
  }
  if (sessionId.startsWith("s3:")) {
    return {
      command: "invalidate_s3_connection",
      connectionId: sessionId.slice("s3:".length),
    };
  }
  return null;
}


import { AI_OPEN_EVENT, type AIOpenIntent } from "./lib/aiEvents";
import type {
  ExternalConnectionChoice,
  ExternalMatchDialogState,
  PostLoginConfirmState,
} from "./lib/appExternalDialogs";
import {
  attachSessionBeforeClose,
  buildStartupCommandPayload,
  capturePaneReconnectContent,
  closeStaleCreatedSession,
  createExternalLocalSession,
  createSessionForConnection,
  createSessionForPane,
  createTemporarySession,
  focusTerminalSession,
  getConnectionSessionType,
  getRemoteDesktopPaneDisplay,
  getTemporaryLinkSessionType,
  isSessionCreationCancelled,
  sendStartupCommandToSession,
  type StartupCommandRequest,
} from "./lib/appSessionFactory";
import {
  buildPanelOpenUpdate,
  canUseFloatingPanel,
  canCreateSessionFromPane,
  clearUnavailableFloatingPanels,
  collectActiveNonSerialSessionIds,
  EXCLUSIVE_PANEL_IDS,
  type FloatingPanelsState,
  getSideOpenPanels,
  getSideOverlayPanel,
  getItemSide,
  getVisibleActivityIds,
  hasLiveSession,
  isActivityItemAvailable,
  isNonSerialSessionType,
  moveFloatingPanelSide,
  NON_PANEL_IDS,
  normalizePanelOpenMode,
  type PanelOpenMode,
  reduceFloatingPanelSelect,
  type TrayAction,
} from "./lib/appWorkspace";
import { collectFileDocumentPaneIds, removePaneFromTabs } from "./lib/appWorkspaceClose";
import {
  type AssetMonitoringCacheEntry,
  buildAssetPatchFromGpuOverview,
  buildAssetPatchFromNpuOverview,
  buildAssetPatchFromRemoteStats,
  recordAssetMonitoringPatch,
} from "./lib/assetMonitoring";
import { updateConnectionAutoIconAfterSessionStart } from "./lib/connectionAutoIcon";
import { getErrorMessage, shouldPromptConnectionEditOnFailure } from "./lib/errors";
import {
  type ExternalConnectionResolution,
  findExternalConnectionMatches,
  parseExternalOpenUrl,
} from "./lib/externalOpen";
import { normalizeHeaderStatusMode } from "./lib/headerStatus";
import { invoke } from "./lib/invoke";
import { logger } from "./lib/logger";
import { NOTE_OPEN_EVENT, type NoteOpenDetail } from "./lib/noteEditorEvents";
import { subscribeOpenSshTerminalAtPath } from "./lib/openSshTerminalAtPath";
import { detectSystemLanguage } from "./lib/systemLanguage";
import {
  launchSavedRemoteDesktop,
  type RemoteDesktopClientInstallRecommendation,
  type RemoteDesktopProtocol,
  shouldLaunchExternalRemoteDesktop,
} from "./lib/remoteDesktop";
import {
  listenOpenSendCommandPanel,
  type SendCommandPanelDraft,
} from "./lib/sendCommandPanelEvents";
import {
  buildTerminalCommandInput,
  clearSessionCommandHistory,
  sendSessionInput,
  sendSessionInputWithSync,
} from "./lib/sessionInput";
import { buildSmartSplitLayout, type SmartSplitMode } from "./lib/smartSplit";
import { getSessionInputPeerIds, purgeSessionFromGroups } from "./lib/syncInputGroups";
import {
  findTerminalWindowLeafById,
  findTerminalWindowLeafByTabId,
  flattenLeafTabs,
  flattenTerminalWindows,
  getFirstTerminalWindowLeaf,
  insertTabAfterInLeaf,
  insertTabIntoLeaf,
  moveTabBetweenLeaves,
  reconcileTerminalWindows,
  reorderTabsGlobally,
  restoreTerminalWindowLayout,
  type SplitEdgeDirection,
  serializeTerminalWindowLayout,
  setLeafActiveTab,
  splitLeafWithTab,
  splitTerminalWindowForTab,
  type TerminalWindowNode,
  updateTerminalWindowSplitRatio,
} from "./lib/tabWindows";
import type { TemporaryLinkConfig } from "./lib/temporaryLink";
import { preserveTerminalReconnectContent } from "./lib/terminalReconnectHistory";
import { setBackendTransferDuplicatePrompt } from "./lib/transferDuplicatePrompt";
import { checkForUpdate, type UpdateInfo } from "./lib/updater";
import { shellQuote } from "./lib/utils";
import {
  getOwnerMainWindowLabel,
  isPrimaryMainWindow,
  type NewSessionTarget,
  openNewSession,
  openNewSessionWithTarget,
  openSettings,
  setOwnerMainWindowLabel,
} from "./lib/windowManager";
import {
  collectSessionPanes,
  findPaneBySessionId,
  findSessionPaneById,
  findTabBySessionId,
  getActivePane,
  getReleasedSessionIds,
  getTabDisplayName,
} from "./lib/workspaceTabs";
import type {
  AppSettings,
  AssetMetadata,
  CloudConflictPreview,
  PaneSplitDirection,
  RecordingMode,
  SavedConnection,
  SessionInfo,
  SessionPane,
  SessionType,
  SshRuntimeMode,
  Tab,
  WorkspaceSessionType,
} from "./types/global";

const STARTUP_OPEN_CONNECTION_TYPES = new Set<SavedConnection["type"]>([
  "ssh",
  "local_terminal",
  "telnet",
  "serial",
]);

function isStartupOpenConnection(connection: SavedConnection) {
  return Boolean(connection.open_on_startup) && STARTUP_OPEN_CONNECTION_TYPES.has(connection.type);
}

function safeRecordingName(name: string) {
  return name.normalize("NFC").replace(/[^\p{L}\p{M}\p{N}._-]+/gu, "_") || "session";
}

function joinPath(dir: string, fileName: string) {
  return `${dir}${dir.endsWith("\\") || dir.endsWith("/") ? "" : "/"}${fileName}`;
}

function eventTargetsCurrentWindow(targetWindowLabel?: string | null) {
  return !targetWindowLabel || targetWindowLabel === getOwnerMainWindowLabel();
}

/** Root layout: header, activity bars, sidebars, terminal area, dialogs. */
function App() {
  useMacSelectionGuard();

  const {
    tabs,
    activeTabId,
    setActiveTabId,
    setActivePane,
    addTab,
    addPendingTab,
    openWorkbenchTab,
    openNoteTab,
    openExternalMarkdownTab,
    updateTabSession,
    markTabConnectionFailed,
    updatePaneSession,
    replaceSessionReferences,
    markPaneConnectionFailed,
    markPaneConnecting,
    hasTab,
    hasPane,
    closePane,
    updateSplitRatio,
    persistTabsNow,
    updateUi,
    updateAppSettings,
    replaceAppSettings,
    appSettings,
    closeTabs,
    savedConnections,
    savedGroups,
    connectionsLoaded,
    recordRecentConnection,
    syncGroups,
    setSyncGroups,
    broadcastToAll,
    setBroadcastToAll,
    isLocked,
    setIsLocked,
    settingsLoaded,
    startupRestoreComplete,
    runtimeInfo,
    runtimeInfoLoaded,
  } = useApp();
  const uiConfig = appSettings.ui;
  const portable = runtimeInfo.portable;
  const remoteStatsEnabled = uiConfig.show_remote_stats ?? true;
  const updateAutoIconForSessionStart = useCallback(
    (connectionId: string | null | undefined, sessionId: string) => {
      void updateConnectionAutoIconAfterSessionStart({
        connectionId,
        sessionId,
        remoteStatsEnabled,
      });
    },
    [remoteStatsEnabled],
  );
  const multiPanelOpen = appSettings.appearance.panel_multi_open;
  const panelOpenMode = normalizePanelOpenMode(uiConfig.panel_open_mode);
  const { t, i18n } = useTranslation();

  useEffect(() => {
    if (!settingsLoaded) return;

    let cancelled = false;

    const waitForPaint = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });

    void (async () => {
      // Paint the shell chrome first; don't wait for session restore (that was
      // making startup feel like a 1s blank pause before anything appeared).
      await waitForPaint();
      if (cancelled) return;

      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      if (cancelled) return;

      const currentWindow = getCurrentWindow();
      setOwnerMainWindowLabel(currentWindow.label);
      try {
        await invoke("reveal_main_window");
      } catch {
        await currentWindow.show().catch(() => {});
        await currentWindow.setFocus().catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [settingsLoaded]);

  useEffect(() => {
    const nextLanguage = appSettings.ui.language?.trim() || detectSystemLanguage();
    if (nextLanguage !== i18n.language) {
      void i18n.changeLanguage(nextLanguage);
    }
  }, [appSettings.ui.language, i18n]);

  const [showAbout, setShowAbout] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [showSyncGroupDialog, setShowSyncGroupDialog] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [showActivityBarResetConfirm, setShowActivityBarResetConfirm] = useState(false);
  const [floatingPanels, setFloatingPanels] = useState<FloatingPanelsState>({
    left: null,
    right: null,
  });
  const [lastFloatingSide, setLastFloatingSide] = useState<"left" | "right" | null>(null);
  const {
    pendingFileDocumentClose,
    savingFileDocuments,
    requestFileDocumentClose,
    handleSaveFileDocumentsAndClose,
    handleDiscardFileDocumentsAndClose,
    handlePendingFileDocumentCloseOpenChange,
  } = useFileDocumentCloseGuard();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [helpDotVisible, setHelpDotVisible] = useState(false);
  const [sendCommandDraft, setSendCommandDraft] = useState<SendCommandPanelDraft | null>(null);
  const [showSessionQuickSwitcher, setShowSessionQuickSwitcher] = useState(false);
  const [sessionSwitcherScope, setSessionSwitcherScope] = useState<"all" | "connections">("all");
  const [showLocalShellPicker, setShowLocalShellPicker] = useState(false);
  const [showTemporarySshLink, setShowTemporarySshLink] = useState(false);
  const [externalMatchDialog, setExternalMatchDialog] = useState<ExternalMatchDialogState | null>(
    null,
  );
  const [postLoginConfirm, setPostLoginConfirm] = useState<PostLoginConfirmState | null>(null);
  const [remoteDesktopMissing, setRemoteDesktopMissing] = useState<{
    protocol: RemoteDesktopProtocol;
    recommendations: RemoteDesktopClientInstallRecommendation[];
  } | null>(null);
  const allowProgrammaticWindowCloseRef = useRef(false);

  const handleSendCommandDraftConsumed = useCallback(() => {
    setSendCommandDraft(null);
  }, []);

  useEffect(() => {
    return listenOpenSendCommandPanel((draft) => {
      setSendCommandDraft(draft);
      updateUi({ show_serial_send_panel: true });
    });
  }, [updateUi]);

  const {
    recordingStatuses,
    recordingSessions,
    liveSessionIds,
    liveSessionsById,
    refreshRecordingStatuses,
  } = useSessionRuntimeState(appSettings.recording.memory_limit_bytes, settingsLoaded);
  const assetMonitoringCacheRef = useRef<Map<string, AssetMonitoringCacheEntry>>(new Map());
  const assetMonitoringFlushesRef = useRef<Set<string>>(new Set());

  const {
    activeHostKeyRequest,
    activeSshAgentRequest,
    activeOtpRequest,
    activeSshAuthRequest,
    queueSecurityPrompt,
    removeSecurityPrompt,
  } = useSecurityPromptQueue();
  const [dockerSudoPasswordRequest, setDockerSudoPasswordRequest] =
    useState<DockerSudoPasswordRequest | null>(null);
  const [rdpCertificateRequests, setRdpCertificateRequests] = useState<
    RdpCertificateVerifyRequest[]
  >([]);
  const [ftpCertificateRequests, setFtpCertificateRequests] = useState<
    FtpCertificateVerifyRequest[]
  >([]);
  const lastCloudConflictRevisionRef = useRef<string | null>(null);
  const modalChildWindowCount = useModalChildWindows();

  // Idle auto-lock
  useIdleLock(
    appSettings.security.enable_screen_lock ? appSettings.security.idle_lock_minutes : 0,
    isLocked,
    () => setIsLocked(true),
  );

  // Background update check on startup
  useEffect(() => {
    if (!runtimeInfoLoaded) return;

    const timer = setTimeout(() => {
      checkForUpdate(portable)
        .then((info) => {
          if (info) {
            setUpdateInfo(info);
            setHelpDotVisible(true);
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearTimeout(timer);
  }, [portable, runtimeInfoLoaded]);

  const closeFloatingPanel = useCallback(
    (side: "left" | "right") => {
      if (!floatingPanels[side]) return;
      const next = { ...floatingPanels, [side]: null };
      setFloatingPanels(next);
      if (lastFloatingSide !== side) return;
      setLastFloatingSide(
        side === "left" ? (next.right ? "right" : null) : next.left ? "left" : null,
      );
    },
    [floatingPanels, lastFloatingSide],
  );

  const handleFloatingPanelSelect = useCallback(
    (panelId: string, side: "left" | "right") => {
      const next = reduceFloatingPanelSelect(floatingPanels, panelId, side);
      const otherSide = side === "left" ? "right" : "left";
      setFloatingPanels(next);
      setLastFloatingSide(next[side] ? side : next[otherSide] ? otherSide : null);
    },
    [floatingPanels],
  );

  const handleFloatingPanelMove = useCallback(
    (panelId: string, targetSide: "left" | "right") => {
      const next = moveFloatingPanelSide(floatingPanels, panelId, targetSide);
      if (next === floatingPanels) return;
      setFloatingPanels(next);
      setLastFloatingSide(targetSide);
    },
    [floatingPanels],
  );

  const handlePanelOpenModeChange = useCallback(
    (mode: PanelOpenMode) => {
      const nextMode = normalizePanelOpenMode(mode);
      setFloatingPanels({ left: null, right: null });
      setLastFloatingSide(null);
      updateUi(
        nextMode === "floating"
          ? {
              active_left_panel: null,
              active_right_panel: null,
              left_open_panels: [],
              right_open_panels: [],
              panel_open_mode: "floating",
            }
          : { panel_open_mode: "docked" },
      );
    },
    [updateUi],
  );

  const openPanel = useCallback(
    (panelId: string, fallbackSide: "left" | "right" = "left") => {
      const side = getItemSide(panelId, uiConfig.activity_bar_layout) ?? fallbackSide;
      if (panelOpenMode === "floating" && canUseFloatingPanel(panelId)) {
        handleFloatingPanelSelect(panelId, side);
        return;
      }
      updateUi((prev) => buildPanelOpenUpdate(prev, panelId, multiPanelOpen, fallbackSide));
    },
    [
      handleFloatingPanelSelect,
      multiPanelOpen,
      panelOpenMode,
      uiConfig.activity_bar_layout,
      updateUi,
    ],
  );

  const handleOpenPanel = useCallback(
    (panelId: "activeSessions" | "syncBackupHistory") => {
      openPanel(panelId);
    },
    [openPanel],
  );

  useEffect(() => {
    if (!settingsLoaded || panelOpenMode !== "floating") return;
    updateUi((prev) => {
      if (
        !prev.active_left_panel &&
        !prev.active_right_panel &&
        (prev.left_open_panels?.length ?? 0) === 0 &&
        (prev.right_open_panels?.length ?? 0) === 0
      ) {
        return {};
      }
      return {
        active_left_panel: null,
        active_right_panel: null,
        left_open_panels: [],
        right_open_panels: [],
      };
    });
  }, [panelOpenMode, settingsLoaded, updateUi]);

  // Cross-window event listeners
  useEffect(() => {
    const unsubs: Promise<() => void>[] = [];

    unsubs.push(
      listen<AppSettings>("settings-changed", () => {
        invoke<AppSettings>("get_app_settings").then((cfg) => {
          replaceAppSettings(cfg);
        });
      }),
    );

    unsubs.push(
      listen<{
        sessionId: string;
        name: string;
        type: WorkspaceSessionType;
        targetLeafId?: string;
        anchorTabId?: string | null;
        targetWindowLabel?: string | null;
      }>("session-created", (event) => {
        const {
          sessionId,
          name: sessionName,
          type,
          targetLeafId,
          anchorTabId,
          targetWindowLabel,
        } = event.payload;
        if (!eventTargetsCurrentWindow(targetWindowLabel)) return;
        const tabId = addTab(
          sessionId,
          sessionName,
          type,
          undefined,
          undefined,
          anchorTabId ? { afterTabId: anchorTabId } : undefined,
        );
        if (targetLeafId) {
          setTerminalWindows((current) =>
            current
              ? insertTabIntoLeaf(current, targetLeafId, tabId, {
                  afterTabId: anchorTabId,
                  activeTabId: tabId,
                })
              : current,
          );
        }
        focusTerminalSession(sessionId);
      }),
    );

    unsubs.push(
      listen<OtpRequest>("otp-request", (event) => {
        if (!eventTargetsCurrentWindow(event.payload.targetWindowLabel)) return;
        queueSecurityPrompt({
          kind: "otp",
          request: event.payload,
        });
      }),
    );

    unsubs.push(
      listen<SshAuthRequest>("ssh-auth-request", (event) => {
        if (!eventTargetsCurrentWindow(event.payload.targetWindowLabel)) return;
        queueSecurityPrompt({
          kind: "ssh-auth",
          request: event.payload,
        });
      }),
    );

    unsubs.push(
      listen<SshAgentAuthRequest>("ssh-agent-auth-pending", (event) => {
        if (!eventTargetsCurrentWindow(event.payload.targetWindowLabel)) return;
        queueSecurityPrompt({
          kind: "ssh-agent",
          request: event.payload,
        });
      }),
    );
    unsubs.push(
      listen<SshAgentAuthRequest>("ssh-agent-auth-failed", (event) => {
        if (!eventTargetsCurrentWindow(event.payload.targetWindowLabel)) return;
        queueSecurityPrompt({
          kind: "ssh-agent",
          request: event.payload,
        });
      }),
    );
    unsubs.push(
      listen<{ requestId: string }>("ssh-agent-auth-resolved", (event) => {
        removeSecurityPrompt(event.payload.requestId);
      }),
    );
    unsubs.push(
      listen<{ requestId: string }>("host-key-verify-resolved", (event) => {
        removeSecurityPrompt(event.payload.requestId);
      }),
    );
    unsubs.push(
      listen<{ requestId: string }>("security-prompt-resolved", (event) => {
        removeSecurityPrompt(event.payload.requestId);
      }),
    );

    unsubs.push(
      listen<DockerSudoPasswordRequest>("docker-sudo-password-request", (event) => {
        if (!eventTargetsCurrentWindow(event.payload.targetWindowLabel)) return;
        setDockerSudoPasswordRequest(event.payload);
      }),
    );

    unsubs.push(
      listen<HostKeyVerifyRequest>("host-key-verify", (event) => {
        if (!eventTargetsCurrentWindow(event.payload.targetWindowLabel)) return;
        queueSecurityPrompt({
          kind: "host-key",
          request: event.payload,
        });
      }),
    );

    unsubs.push(
      listen<RdpCertificateVerifyRequest>("rdp-certificate-verify", (event) => {
        if (!eventTargetsCurrentWindow(event.payload.targetWindowLabel)) return;
        setRdpCertificateRequests((current) => {
          if (current.some((item) => item.requestId === event.payload.requestId)) return current;
          return [...current, event.payload];
        });
      }),
    );

    unsubs.push(
      listen<FtpCertificateVerifyRequest>("ftp-certificate-verify", (event) => {
        if (!eventTargetsCurrentWindow(event.payload.targetWindowLabel)) return;
        setFtpCertificateRequests((current) => {
          if (current.some((item) => item.requestId === event.payload.requestId)) return current;
          return [...current, event.payload];
        });
      }),
    );

    unsubs.push(
      listen<{
        requestId: string;
        sessionId: string;
        remotePath: string;
        fileName: string;
        isDirectory: boolean;
        targetWindowLabel?: string | null;
      }>("transfer-duplicate-request", (event) => {
        if (!eventTargetsCurrentWindow(event.payload.targetWindowLabel)) return;
        setBackendTransferDuplicatePrompt({
          requestId: event.payload.requestId,
          sessionId: event.payload.sessionId,
          remotePath: event.payload.remotePath,
          fileName: event.payload.fileName,
          isDirectory: event.payload.isDirectory,
          targetWindowLabel: event.payload.targetWindowLabel,
          respondViaBackend: true,
        });
      }),
    );

    unsubs.push(
      listen<{
        connectionId: string;
        targetLeafId?: string;
        anchorTabId?: string | null;
        sourceTabId?: string;
        sourcePaneId?: string;
        targetWindowLabel?: string | null;
      }>("session-connect-after-edit", async (event) => {
        const {
          connectionId,
          targetLeafId,
          anchorTabId,
          sourceTabId,
          sourcePaneId,
          targetWindowLabel,
        } = event.payload;
        if (!eventTargetsCurrentWindow(targetWindowLabel)) return;
        try {
          const conns = await invoke<SavedConnection[]>("get_saved_connections");
          const conn = conns.find((c) => c.id === connectionId);
          if (conn && shouldLaunchExternalRemoteDesktop(conn)) {
            try {
              const result = await launchSavedRemoteDesktop(conn);
              if (result.status === "missing_client") {
                setRemoteDesktopMissing({
                  protocol: result.protocol,
                  recommendations: result.recommendations,
                });
                return;
              }
              recordRecentConnection(conn.id);
              updateUi({ saved_connections_last_opened_connection_id: conn.id });
              toast.success(
                t("remoteDesktop.launched", {
                  name: conn.name,
                  client: result.client_name,
                  defaultValue: "Opened {{name}} with {{client}}",
                }),
              );
            } catch (error) {
              toast.error(
                t("savedConnections.connectionFailed", { error: getErrorMessage(error) }),
              );
            }
            return;
          }
          const connName = conn?.name ?? connectionId;
          const sessionType = getConnectionSessionType(conn);
          const sourceTab = sourceTabId
            ? (tabsRef.current.find((item) => item.id === sourceTabId) ?? null)
            : null;
          const sourcePane =
            sourceTab &&
            ((sourcePaneId ? findSessionPaneById(sourceTab.root, sourcePaneId) : null) ??
              getActivePane(sourceTab));
          let tabId: string;
          let paneId: string | undefined;
          let createRequestId: string | null = null;

          if (sourceTab && sourcePane) {
            tabId = sourceTab.id;
            paneId = sourcePane.id;
            setActiveTabId(tabId);
            setActivePane(tabId, paneId);
            createRequestId = markPaneConnecting(tabId, paneId, {
              name: connName,
              type: sessionType,
              connectionId,
              view: undefined,
              display: getRemoteDesktopPaneDisplay(conn),
            });
          } else {
            const pending = addPendingTab(
              connName,
              sessionType,
              connectionId,
              undefined,
              anchorTabId ? { afterTabId: anchorTabId } : undefined,
              { display: getRemoteDesktopPaneDisplay(conn) },
            );
            tabId = pending.tabId;
            createRequestId = pending.createRequestId;
            if (targetLeafId) {
              setTerminalWindows((current) =>
                current
                  ? insertTabIntoLeaf(current, targetLeafId, tabId, {
                      afterTabId: anchorTabId,
                      activeTabId: tabId,
                    })
                  : current,
              );
            }
          }

          try {
            let sessionId: string;
            switch (conn?.type) {
              case "local_terminal":
                sessionId = await invoke<string>("create_local_session", {
                  connectionId,
                  createRequestId,
                });
                break;
              case "telnet":
                sessionId = await invoke<string>("create_telnet_session", {
                  connectionId,
                  createRequestId,
                });
                break;
              case "serial":
                sessionId = await invoke<string>("create_serial_session", {
                  connectionId,
                  createRequestId,
                });
                break;
              case "rdp":
                sessionId = await invoke<string>("create_rdp_session", {
                  connectionId,
                  createRequestId,
                });
                break;
              default:
                sessionId = await invoke<string>("create_ssh_session", {
                  connectionId,
                  createRequestId,
                });
                break;
            }
            if (paneId ? !hasPane(tabId, paneId) : !hasTab(tabId)) {
              await closeStaleCreatedSession(sessionId);
              return;
            }
            if (paneId) {
              updatePaneSession(tabId, paneId, sessionId);
            } else {
              updateTabSession(tabId, sessionId);
            }
            focusTerminalSession(sessionId);
            recordRecentConnection(connectionId);
            updateAutoIconForSessionStart(connectionId, sessionId);
          } catch (error) {
            if (
              isSessionCreationCancelled(error) ||
              (paneId ? !hasPane(tabId, paneId) : !hasTab(tabId))
            ) {
              return;
            }
            const errorMessage = getErrorMessage(error);
            if (paneId) {
              markPaneConnectionFailed(tabId, paneId, errorMessage);
            } else {
              markTabConnectionFailed(tabId, errorMessage);
            }
            if (shouldPromptConnectionEditOnFailure(conn, errorMessage)) {
              openNewSession(connectionId, true, {
                sourceTabId: tabId,
                sourcePaneId: paneId,
              });
            }
          }
        } catch {
          /* ignore */
        }
      }),
    );

    return () => {
      unsubs.forEach((p) => {
        p.then((unsub) => unsub());
      });
    };
  }, [
    addTab,
    addPendingTab,
    hasPane,
    hasTab,
    markPaneConnecting,
    markPaneConnectionFailed,
    markTabConnectionFailed,
    queueSecurityPrompt,
    recordRecentConnection,
    removeSecurityPrompt,
    setActivePane,
    setActiveTabId,
    t,
    updateAutoIconForSessionStart,
    updatePaneSession,
    updateTabSession,
    updateUi,
    replaceAppSettings,
  ]);

  useEffect(() => {
    const unlisten = listen<CloudConflictPreview | null>("cloud-sync-conflict", (event) => {
      const conflict = event.payload;
      if (!conflict) return;
      if (lastCloudConflictRevisionRef.current === conflict.remote_revision) {
        return;
      }

      lastCloudConflictRevisionRef.current = conflict.remote_revision;
      toast.error(conflict.message);
      handleOpenPanel("syncBackupHistory");
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, [handleOpenPanel]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeTabName = activeTab ? getTabDisplayName(activeTab).trim() : "";
  const windowTitle = activeTabName ? `${activeTabName} - NyaTerm` : "NyaTerm";
  const activePane = activeTab ? getActivePane(activeTab) : null;
  const activeConnection = activePane?.connectionId
    ? (savedConnections.find((connection) => connection.id === activePane.connectionId) ?? null)
    : null;
  const [aiIntent, setAiIntent] = useState<AIOpenIntent | null>(null);
  const [terminalWindows, setTerminalWindows] = useState<TerminalWindowNode | null>(null);
  const previousActiveTabIdRef = useRef<string | null>(null);
  const terminalWindowsRef = useRef<TerminalWindowNode | null>(null);
  const terminalWindowsRestoredRef = useRef(false);
  const terminalWindowsHydratedRef = useRef(false);
  const preserveRestoredLeafActiveTabsRef = useRef(false);
  const restoredGlobalActiveTabIdRef = useRef<string | null>(null);
  const lastPersistedTerminalWindowLayoutKeyRef = useRef(
    JSON.stringify(uiConfig.terminal_window_layout ?? null),
  );
  const tabsRef = useRef(tabs);
  const tabsById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs]);
  const savedSshConnectionIdBySessionId = useMemo(() => {
    const sshConnectionIds = new Set(
      savedConnections
        .filter((connection) => connection.type === "ssh")
        .map((connection) => connection.id),
    );
    const result = new Map<string, string>();

    for (const tab of tabs) {
      for (const pane of collectSessionPanes(tab.root)) {
        if (
          pane.paneKind === "terminal" &&
          !pane.connecting &&
          !pane.connectError &&
          pane.type === "SSH" &&
          pane.connectionId &&
          sshConnectionIds.has(pane.connectionId)
        ) {
          result.set(pane.sessionId, pane.connectionId);
        }
      }
    }

    return result;
  }, [savedConnections, tabs]);

  const handleAssetMonitoringPatch = useCallback(
    (sessionId: string, patch: AssetMetadata) => {
      const connectionId = savedSshConnectionIdBySessionId.get(sessionId);
      if (!connectionId) return;

      recordAssetMonitoringPatch(assetMonitoringCacheRef.current, sessionId, connectionId, patch);
    },
    [savedSshConnectionIdBySessionId],
  );

  const flushAssetMonitoringCache = useCallback(async (sessionId: string) => {
    const entry = assetMonitoringCacheRef.current.get(sessionId);
    if (!entry || assetMonitoringFlushesRef.current.has(sessionId)) return;

    assetMonitoringFlushesRef.current.add(sessionId);
    try {
      await invoke("update_connection_asset_from_monitoring", {
        connectionId: entry.connectionId,
        assetPatch: {
          ...entry.lastAssetPatch,
          updated_at: new Date().toISOString(),
        },
      });
      assetMonitoringCacheRef.current.delete(sessionId);
    } catch (error) {
      const message = getErrorMessage(error).toLowerCase();
      if (message.includes("not found")) {
        assetMonitoringCacheRef.current.delete(sessionId);
      }
      logger.error({
        domain: "session.lifecycle",
        event: "asset.flush_failed",
        message: "Failed to save monitored asset snapshot",
        ids: { connection_id: entry.connectionId, session_id: sessionId },
        error,
      });
    } finally {
      assetMonitoringFlushesRef.current.delete(sessionId);
    }
  }, []);

  useEffect(() => {
    if (liveSessionIds === null) return;

    for (const sessionId of assetMonitoringCacheRef.current.keys()) {
      if (!liveSessionIds.has(sessionId)) {
        void flushAssetMonitoringCache(sessionId);
      }
    }
  }, [flushAssetMonitoringCache, liveSessionIds]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const getActiveWorkbenchTarget = useCallback(() => {
    if (!activeTabId) return null;
    const tab = tabsRef.current.find((item) => item.id === activeTabId);
    if (!tab) return null;
    const pane = getActivePane(tab);
    if (!pane || pane.view !== "workbench") return null;
    return { tabId: tab.id, paneId: pane.id };
  }, [activeTabId]);

  const beginPendingSession = useCallback(
    (
      name: string,
      type: WorkspaceSessionType,
      connectionId?: string,
      options?: { view?: SessionPane["view"] },
      paneOverrides?: Partial<SessionPane> & {
        display?: Extract<SessionPane, { paneKind: "remote-desktop" }>["display"];
      },
    ): { tabId: string; paneId?: string; createRequestId: string } => {
      const workbench = getActiveWorkbenchTarget();
      if (workbench) {
        const createRequestId = markPaneConnecting(workbench.tabId, workbench.paneId, {
          name,
          type,
          connectionId,
          view: options?.view,
          temporaryConfig: paneOverrides?.temporaryConfig,
          display: paneOverrides?.display,
        });
        if (createRequestId) {
          return {
            tabId: workbench.tabId,
            paneId: workbench.paneId,
            createRequestId,
          };
        }
      }

      const pending = addPendingTab(
        name,
        type,
        connectionId,
        undefined,
        options?.view ? { view: options.view } : undefined,
        paneOverrides,
      );
      return {
        tabId: pending.tabId,
        createRequestId: pending.createRequestId,
      };
    },
    [addPendingTab, getActiveWorkbenchTarget, markPaneConnecting],
  );

  useEffect(() => {
    terminalWindowsRef.current = terminalWindows;
  }, [terminalWindows]);

  useEffect(() => {
    if (terminalWindowsRestoredRef.current) return;
    lastPersistedTerminalWindowLayoutKeyRef.current = JSON.stringify(
      uiConfig.terminal_window_layout ?? null,
    );
  }, [uiConfig.terminal_window_layout]);

  useEffect(() => {
    let cancelled = false;

    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        if (cancelled) return;
        return getCurrentWindow().setTitle(windowTitle);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [windowTitle]);

  const handleNewSession = useCallback(
    (parentGroupId?: string) => {
      const workbench = getActiveWorkbenchTarget();
      openNewSession(undefined, undefined, {
        ...(parentGroupId ? { initialGroupId: parentGroupId } : {}),
        ...(workbench ? { sourceTabId: workbench.tabId, sourcePaneId: workbench.paneId } : {}),
      });
    },
    [getActiveWorkbenchTarget],
  );

  const handleOpenWorkbench = useCallback(() => {
    updateUi({ start_workspace_mode: "workbench" });
    openWorkbenchTab(t("terminal.openWorkbench"));
  }, [openWorkbenchTab, t, updateUi]);

  const handleEditConnection = useCallback(
    (conn: SavedConnection, autoConnect?: boolean, target?: NewSessionTarget) => {
      const workbench = getActiveWorkbenchTarget();
      openNewSession(conn.id, autoConnect, {
        ...target,
        ...(workbench && !target?.sourceTabId
          ? { sourceTabId: workbench.tabId, sourcePaneId: workbench.paneId }
          : {}),
      });
    },
    [getActiveWorkbenchTarget],
  );

  const maybePromptConnectionEdit = useCallback(
    (
      connectionId: string | undefined,
      errorMessage: string,
      target?: Pick<NewSessionTarget, "sourceTabId" | "sourcePaneId">,
    ) => {
      if (!connectionId) return;
      const connection = savedConnections.find((item) => item.id === connectionId);
      if (shouldPromptConnectionEditOnFailure(connection, errorMessage)) {
        openNewSession(connectionId, true, target);
      }
    },
    [savedConnections],
  );

  const openS3Workspace = useCallback(
    (connection: SavedConnection) => {
      if (connection.type !== "s3") {
        toast.error(t("savedConnections.openS3Only"));
        return;
      }

      const existing = tabsRef.current.find((tab) =>
        collectSessionPanes(tab.root).some(
          (pane) => pane.view === "s3" && pane.connectionId === connection.id,
        ),
      );
      if (existing) {
        setActiveTabId(existing.id);
        recordRecentConnection(connection.id);
        updateUi({ saved_connections_last_opened_connection_id: connection.id });
        return;
      }

      const tabName = t("s3Workspace.tabTitle", { name: connection.name });
      addPendingTab(
        tabName,
        "S3",
        connection.id,
        undefined,
        { view: "s3" },
        {
          connecting: false,
          sessionId: `s3:${connection.id}`,
        },
      );
      recordRecentConnection(connection.id);
      updateUi({ saved_connections_last_opened_connection_id: connection.id });
    },
    [addPendingTab, recordRecentConnection, setActiveTabId, t, updateUi],
  );

  const openFtpWorkspace = useCallback(
    (connection: SavedConnection) => {
      if (connection.type !== "ftp") {
        toast.error(t("savedConnections.openFtpOnly"));
        return;
      }

      const existing = tabsRef.current.find((tab) =>
        collectSessionPanes(tab.root).some(
          (pane) => pane.view === "ftp" && pane.connectionId === connection.id,
        ),
      );
      if (existing) {
        void invoke("invalidate_ftp_connection", { connection_id: connection.id });
        setActiveTabId(existing.id);
        recordRecentConnection(connection.id);
        updateUi({ saved_connections_last_opened_connection_id: connection.id });
        return;
      }

      const tabName = t("ftpWorkspace.tabTitle", { name: connection.name });
      addPendingTab(
        tabName,
        "FTP",
        connection.id,
        undefined,
        { view: "ftp" },
        {
          connecting: false,
          sessionId: `ftp:${connection.id}`,
        },
      );
      recordRecentConnection(connection.id);
      updateUi({ saved_connections_last_opened_connection_id: connection.id });
    },
    [addPendingTab, invoke, recordRecentConnection, setActiveTabId, t, updateUi],
  );

  const openWebDavWorkspace = useCallback(
    (connection: SavedConnection) => {
      if (connection.type !== "webdav") {
        toast.error(t("savedConnections.openWebDavOnly"));
        return;
      }

      const existing = tabsRef.current.find((tab) =>
        collectSessionPanes(tab.root).some(
          (pane) => pane.view === "webdav" && pane.connectionId === connection.id,
        ),
      );
      if (existing) {
        clearFileExplorerSessionCacheForSession(`webdav:${connection.id}`);
        clearDirectoryChildrenCacheForSession(`webdav:${connection.id}`);
        void invoke("invalidate_webdav_connection", { connection_id: connection.id });
        setActiveTabId(existing.id);
        recordRecentConnection(connection.id);
        updateUi({ saved_connections_last_opened_connection_id: connection.id });
        return;
      }

      const tabName = t("webdavWorkspace.tabTitle", { name: connection.name });
      addPendingTab(
        tabName,
        "WebDAV",
        connection.id,
        undefined,
        { view: "webdav" },
        {
          connecting: false,
          sessionId: `webdav:${connection.id}`,
        },
      );
      recordRecentConnection(connection.id);
      updateUi({ saved_connections_last_opened_connection_id: connection.id });
    },
    [addPendingTab, invoke, recordRecentConnection, setActiveTabId, t, updateUi],
  );

  const connectSavedConnection = useCallback(
    async (
      connection: SavedConnection,
      options?: {
        failureContext?: string;
        runtimeModeOverride?: SshRuntimeMode;
      },
    ) => {
      if (connection.type === "s3") {
        openS3Workspace(connection);
        return;
      }

      if (connection.type === "ftp") {
        openFtpWorkspace(connection);
        return;
      }

      if (connection.type === "webdav") {
        openWebDavWorkspace(connection);
        return;
      }

      if (shouldLaunchExternalRemoteDesktop(connection)) {
        try {
          const result = await launchSavedRemoteDesktop(connection);
          if (result.status === "missing_client") {
            setRemoteDesktopMissing({
              protocol: result.protocol,
              recommendations: result.recommendations,
            });
            return;
          }
          recordRecentConnection(connection.id);
          updateUi({ saved_connections_last_opened_connection_id: connection.id });
          toast.success(
            t("remoteDesktop.launched", {
              name: connection.name,
              client: result.client_name,
              defaultValue: "Opened {{name}} with {{client}}",
            }),
          );
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          logger.error({
            domain: "session.lifecycle",
            event: "remote_desktop.open_failed",
            message: options?.failureContext ?? "Remote desktop launch failed",
            ids: { connection_id: connection.id },
            error,
          });
          toast.error(t("savedConnections.connectionFailed", { error: errorMessage }));
        }
        return;
      }

      const pending = beginPendingSession(

        connection.name,
        getConnectionSessionType(connection),
        connection.id,
        undefined,
        { display: getRemoteDesktopPaneDisplay(connection) },
      );
      const { tabId, paneId, createRequestId } = pending;

      try {
        const sessionId = await createSessionForConnection(
          connection,
          createRequestId,
          undefined,
          options?.runtimeModeOverride,
        );
        if (paneId ? !hasPane(tabId, paneId) : !hasTab(tabId)) {

          await closeStaleCreatedSession(sessionId);
          return;
        }
        if (paneId) {
          updatePaneSession(tabId, paneId, sessionId);
        } else {
          updateTabSession(tabId, sessionId);
        }
        focusTerminalSession(sessionId);
        recordRecentConnection(connection.id);
        updateAutoIconForSessionStart(connection.id, sessionId);
      } catch (error) {
        if (
          isSessionCreationCancelled(error) ||
          (paneId ? !hasPane(tabId, paneId) : !hasTab(tabId))
        ) {
          return;
        }
        const errorMessage = getErrorMessage(error);
        logger.error({
          domain: "session.lifecycle",
          event: "connection.open_failed",
          message: options?.failureContext ?? "Connection failed",
          ids: { connection_id: connection.id },
          error,
        });
        if (paneId) {
          markPaneConnectionFailed(tabId, paneId, errorMessage);
        } else {
          markTabConnectionFailed(tabId, errorMessage);
        }
        maybePromptConnectionEdit(connection.id, errorMessage, {
          sourceTabId: tabId,
          sourcePaneId: paneId,
        });
        toast.error(t("savedConnections.connectionFailed", { error: errorMessage }));
      }
    },
    [
      beginPendingSession,
      hasPane,
      hasTab,
      markPaneConnectionFailed,
      markTabConnectionFailed,
      maybePromptConnectionEdit,
      openS3Workspace,
      openFtpWorkspace,
      openWebDavWorkspace,
      recordRecentConnection,
      t,
      updateAutoIconForSessionStart,
      updatePaneSession,
      updateTabSession,
      updateUi,
    ],
  );

  const openSftpWorkspace = useCallback(
    async (connection: SavedConnection) => {
      if (connection.type !== "ssh") {
        toast.error(t("savedConnections.openSftpSshOnly"));
        return;
      }
      if (connection.sftp?.enabled === false) {
        toast.error(t("savedConnections.openSftpDisabled"));
        return;
      }

      const tabName = t("sftpWorkspace.tabTitle", { name: connection.name });
      const pending = beginPendingSession(tabName, "SSH", connection.id, { view: "sftp" });
      const { tabId, paneId, createRequestId } = pending;

      try {
        const sessionId = await createSessionForConnection(connection, createRequestId);
        if (paneId ? !hasPane(tabId, paneId) : !hasTab(tabId)) {
          await closeStaleCreatedSession(sessionId);
          return;
        }
        if (paneId) {
          updatePaneSession(tabId, paneId, sessionId);
        } else {
          updateTabSession(tabId, sessionId);
        }
        recordRecentConnection(connection.id);
        updateUi({ saved_connections_last_opened_connection_id: connection.id });
        updateAutoIconForSessionStart(connection.id, sessionId);
      } catch (error) {
        if (
          isSessionCreationCancelled(error) ||
          (paneId ? !hasPane(tabId, paneId) : !hasTab(tabId))
        ) {
          return;
        }
        const errorMessage = getErrorMessage(error);
        logger.error({
          domain: "session.lifecycle",
          event: "sftp_workspace.open_failed",
          message: "Open SFTP workspace failed",
          ids: { connection_id: connection.id },
          error,
        });
        if (paneId) {
          markPaneConnectionFailed(tabId, paneId, errorMessage);
        } else {
          markTabConnectionFailed(tabId, errorMessage);
        }
        maybePromptConnectionEdit(connection.id, errorMessage, {
          sourceTabId: tabId,
          sourcePaneId: paneId,
        });
        toast.error(t("savedConnections.connectionFailed", { error: errorMessage }));
      }
    },
    [
      beginPendingSession,
      hasPane,
      hasTab,
      markPaneConnectionFailed,
      markTabConnectionFailed,
      maybePromptConnectionEdit,
      recordRecentConnection,
      t,
      updateAutoIconForSessionStart,
      updatePaneSession,
      updateTabSession,
      updateUi,
    ],
  );

  const openSshTerminalAtRemotePath = useCallback(
    async (connectionId: string, path: string) => {
      const connection = savedConnections.find((item) => item.id === connectionId);
      if (!connection || connection.type !== "ssh") {
        toast.error(t("savedConnections.openSftpSshOnly"));
        return;
      }

      const directoryPath = path.trim();
      if (!directoryPath) return;

      const startupCommand = {
        command: `cd ${shellQuote(directoryPath)}`,
        delayMs: 800,
      };
      const pending = addPendingTab(connection.name, "SSH", connection.id);
      const { tabId, createRequestId } = pending;

      try {
        const sessionId = await createSessionForConnection(
          connection,
          createRequestId,
          startupCommand,
        );
        if (!hasTab(tabId)) {
          await closeStaleCreatedSession(sessionId);
          return;
        }
        updateTabSession(tabId, sessionId);
        focusTerminalSession(sessionId);
        recordRecentConnection(connection.id);
        updateUi({ saved_connections_last_opened_connection_id: connection.id });
        updateAutoIconForSessionStart(connection.id, sessionId);
      } catch (error) {
        if (isSessionCreationCancelled(error) || !hasTab(tabId)) {
          return;
        }
        const errorMessage = getErrorMessage(error);
        logger.error({
          domain: "session.lifecycle",
          event: "sftp_open_terminal_here_failed",
          message: "Open SSH terminal at path failed",
          ids: { connection_id: connection.id },
          error,
        });
        markTabConnectionFailed(tabId, errorMessage);
        toast.error(t("savedConnections.connectionFailed", { error: errorMessage }));
      }
    },
    [
      addPendingTab,
      hasTab,
      markTabConnectionFailed,
      recordRecentConnection,
      savedConnections,
      t,
      updateAutoIconForSessionStart,
      updateTabSession,
      updateUi,
    ],
  );

  useEffect(() => {
    return subscribeOpenSshTerminalAtPath((detail) => {
      void openSshTerminalAtRemotePath(detail.connectionId, detail.path);
    });
  }, [openSshTerminalAtRemotePath]);

  const connectTemporaryConnection = useCallback(
    async (config: TemporaryLinkConfig) => {
      const pending = beginPendingSession(
        config.name,
        getTemporaryLinkSessionType(config),
        undefined,
        undefined,
        { temporaryConfig: config },
      );
      const { tabId, paneId, createRequestId } = pending;

      try {
        const sessionId = await createTemporarySession(config, createRequestId);
        if (paneId ? !hasPane(tabId, paneId) : !hasTab(tabId)) {
          await closeStaleCreatedSession(sessionId);
          return;
        }
        if (paneId) {
          updatePaneSession(tabId, paneId, sessionId);
        } else {
          updateTabSession(tabId, sessionId);
        }
        focusTerminalSession(sessionId);
      } catch (error) {
        if (
          isSessionCreationCancelled(error) ||
          (paneId ? !hasPane(tabId, paneId) : !hasTab(tabId))
        ) {
          return;
        }
        const errorMessage = getErrorMessage(error);
        logger.error({
          domain: "session.lifecycle",
          event: "temporary_link.open_failed",
          message: "Temporary connection failed",
          error,
        });
        if (paneId) {
          markPaneConnectionFailed(tabId, paneId, errorMessage);
        } else {
          markTabConnectionFailed(tabId, errorMessage);
        }
        toast.error(t("savedConnections.connectionFailed", { error: errorMessage }));
      }
    },
    [
      beginPendingSession,
      hasPane,
      hasTab,
      markPaneConnectionFailed,
      markTabConnectionFailed,
      t,
      updatePaneSession,
      updateTabSession,
    ],
  );

  const connectExternalLocalSession = useCallback(
    async (workingDir: string | null) => {
      const pending = addPendingTab(
        t("menu.newLocalTerminal"),
        "Local",
        undefined,
      );
      const { tabId, createRequestId } = pending;

      try {
        const sessionId = await createExternalLocalSession(
          workingDir,
          createRequestId,
        );
        if (!hasTab(tabId)) {
          await closeStaleCreatedSession(sessionId);
          return;
        }
        updateTabSession(tabId, sessionId);
        focusTerminalSession(sessionId);
      } catch (error) {
        if (isSessionCreationCancelled(error) || !hasTab(tabId)) {
          return;
        }
        const errorMessage = getErrorMessage(error);
        logger.error({
          domain: "session.lifecycle",
          event: "external_local.open_failed",
          message: "External local terminal failed",
          error,
        });
        markTabConnectionFailed(tabId, errorMessage);
        toast.error(t("savedConnections.connectionFailed", { error: errorMessage }));
      }
    },
    [addPendingTab, hasTab, markTabConnectionFailed, t, updateTabSession],
  );

  const chooseExternalConnection = useCallback(
    (resolution: Extract<ExternalConnectionResolution, { kind: "ambiguous" }>) =>
      new Promise<ExternalConnectionChoice>((resolve) => {
        setExternalMatchDialog({
          connections: resolution.connections,
          temporary: resolution.temporary,
          runtimeModeOverride: resolution.runtimeModeOverride,
          resolve,
        });
      }),
    [],
  );

  const confirmExternalPostLogin = useCallback((connection: SavedConnection) => {
    const command = connection.post_login?.command?.trim() ?? "";
    if (!connection.post_login?.enabled || !command) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      setPostLoginConfirm({ connection, command, resolve });
    });
  }, []);

  const handleExternalOpenRequest = useCallback(
    async (request: ExternalOpenRequest) => {
      logger.info({
        domain: "app.lifecycle",
        event: "external_open.request_received",
        message: "Received external open request in target window",
        ids: { request_id: request.id },
        data: {
          source: request.source,
          target_window_label: request.targetWindowLabel,
          kind: request.kind,
        },
      });

      if (request.kind === "markdownFile") {
        openExternalMarkdownTab(request.rawUrl);
        return;
      }

      const parsed = parseExternalOpenUrl(request.rawUrl);
      if (!parsed.ok) {
        logger.warn({
          domain: "app.lifecycle",
          event: "external_open.request_rejected",
          message: "Rejected external open request in frontend",
          ids: { request_id: request.id },
          data: {
            scheme: parsed.scheme,
            source: request.source,
            target_window_label: request.targetWindowLabel,
            error_type: parsed.errorType,
          },
        });
        toast.error(t(parsed.errorKey));
        return;
      }

      if (parsed.intent.protocol === "local") {
        logger.info({
          domain: "app.lifecycle",
          event: "external_open.local_terminal_created",
          message: "External open will create a local terminal",
          ids: { request_id: request.id },
          data: {
            scheme: parsed.intent.protocol,
            source: request.source,
            target_window_label: request.targetWindowLabel,
            has_working_dir: parsed.intent.workingDir !== null,
          },
        });
        await connectExternalLocalSession(parsed.intent.workingDir);
        return;
      }

      const latestConnections = await invoke<SavedConnection[]>("get_saved_connections");
      const resolution = findExternalConnectionMatches(latestConnections, parsed.intent);

      if (resolution.kind === "saved") {
        logger.info({
          domain: "app.lifecycle",
          event: "external_open.connection_matched",
          message: "External open matched a saved connection",
          ids: { request_id: request.id },
          data: {
            scheme: parsed.intent.protocol,
            source: request.source,
            target_window_label: request.targetWindowLabel,
            candidate_count: 1,
          },
        });
        if (await confirmExternalPostLogin(resolution.connection)) {
          await connectSavedConnection(resolution.connection, {
            failureContext: "External open saved connection failed",
            runtimeModeOverride: resolution.runtimeModeOverride,
          });
        }
        return;
      }

      if (resolution.kind === "ambiguous") {
        logger.info({
          domain: "app.lifecycle",
          event: "external_open.connection_ambiguous",
          message: "External open matched multiple saved connections",
          ids: { request_id: request.id },
          data: {
            scheme: parsed.intent.protocol,
            source: request.source,
            target_window_label: request.targetWindowLabel,
            candidate_count: resolution.connections.length,
          },
        });
        const choice = await chooseExternalConnection(resolution);
        if (choice.kind === "saved") {
          if (await confirmExternalPostLogin(choice.connection)) {
            await connectSavedConnection(choice.connection, {
              failureContext: "External open saved connection failed",
              runtimeModeOverride: choice.runtimeModeOverride,
            });
          }
        } else if (choice.kind === "temporary") {
          await connectTemporaryConnection(choice.config);
        }
        return;
      }

      if (resolution.kind === "temporary") {
        logger.info({
          domain: "app.lifecycle",
          event: "external_open.temporary_connection_created",
          message: "External open will create a temporary connection",
          ids: { request_id: request.id },
          data: {
            scheme: parsed.intent.protocol,
            source: request.source,
            target_window_label: request.targetWindowLabel,
            candidate_count: 0,
          },
        });
        await connectTemporaryConnection(resolution.config);
      }
    },
    [
      chooseExternalConnection,
      confirmExternalPostLogin,
      connectExternalLocalSession,
      connectSavedConnection,
      connectTemporaryConnection,
      openExternalMarkdownTab,
      t,
    ],
  );

  useExternalOpenRequests({
    ready: settingsLoaded && startupRestoreComplete && !isLocked,
    onRequest: handleExternalOpenRequest,
  });

  const hasOpenedStartupConnectionsRef = useRef(false);

  useEffect(() => {
    if (
      !settingsLoaded ||
      !startupRestoreComplete ||
      !connectionsLoaded ||
      isLocked ||
      !isPrimaryMainWindow()
    ) {
      return;
    }
    if (hasOpenedStartupConnectionsRef.current) return;
    hasOpenedStartupConnectionsRef.current = true;

    const existingConnectionIds = new Set<string>();
    for (const tab of tabs) {
      for (const pane of collectSessionPanes(tab.root)) {
        if (pane.connectionId) existingConnectionIds.add(pane.connectionId);
      }
    }

    const toOpen = savedConnections
      .filter(
        (connection) =>
          isStartupOpenConnection(connection) && !existingConnectionIds.has(connection.id),
      )
      .sort((a, b) => {
        const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
        if (orderDiff !== 0) return orderDiff;
        return a.name.localeCompare(b.name);
      });

    if (toOpen.length === 0) return;

    void (async () => {
      for (const connection of toOpen) {
        try {
          await connectSavedConnection(connection, {
            failureContext: "Connection failed from startup open",
          });
        } catch (error) {
          logger.error({
            domain: "session.lifecycle",
            event: "session.startup_open_failed",
            message: "Failed to open startup connection",
            ids: { connection_id: connection.id },
            error,
          });
        }
      }
    })();
  }, [
    connectSavedConnection,
    connectionsLoaded,
    isLocked,
    savedConnections,
    settingsLoaded,
    startupRestoreComplete,
    tabs,
  ]);

  const persistTerminalWindowLayout = useCallback(
    (layout: TerminalWindowNode | null, nextTabs: Tab[] = tabsRef.current) => {
      if (!settingsLoaded || !startupRestoreComplete || !appSettings.general.startup_restore)
        return;
      const terminalWindowLayout =
        appSettings.general.startup_restore_window_layout === false
          ? null
          : serializeTerminalWindowLayout(layout, nextTabs);
      const layoutKey = JSON.stringify(terminalWindowLayout ?? null);
      if (layoutKey === lastPersistedTerminalWindowLayoutKeyRef.current) return;
      lastPersistedTerminalWindowLayoutKeyRef.current = layoutKey;
      updateUi({ terminal_window_layout: terminalWindowLayout });
    },
    [
      appSettings.general.startup_restore,
      appSettings.general.startup_restore_window_layout,
      settingsLoaded,
      startupRestoreComplete,
      updateUi,
    ],
  );

  useEffect(() => {
    if (!preserveRestoredLeafActiveTabsRef.current) return;
    if (restoredGlobalActiveTabIdRef.current === null) return;
    if (activeTabId === restoredGlobalActiveTabIdRef.current) return;
    preserveRestoredLeafActiveTabsRef.current = false;
    restoredGlobalActiveTabIdRef.current = null;
  }, [activeTabId]);

  useEffect(() => {
    if (!settingsLoaded || !startupRestoreComplete) return;

    setTerminalWindows((current) => {
      let next = current;
      let preserveRestoredLeafActiveTabs = preserveRestoredLeafActiveTabsRef.current;

      if (!terminalWindowsRestoredRef.current) {
        terminalWindowsRestoredRef.current = true;
        if (
          appSettings.general.startup_restore &&
          appSettings.general.startup_restore_window_layout !== false &&
          tabs.length > 0
        ) {
          const restored = restoreTerminalWindowLayout(uiConfig.terminal_window_layout, tabs);
          if (restored) {
            next = restored;
            preserveRestoredLeafActiveTabs = true;
            preserveRestoredLeafActiveTabsRef.current = true;
            restoredGlobalActiveTabIdRef.current = activeTabId;
          }
        }
      }

      const reconciled = reconcileTerminalWindows(
        next,
        tabs,
        preserveRestoredLeafActiveTabs ? null : activeTabId,
        previousActiveTabIdRef.current,
      );
      terminalWindowsHydratedRef.current = true;
      terminalWindowsRef.current = reconciled;
      return reconciled;
    });
    previousActiveTabIdRef.current = activeTabId;
  }, [
    activeTabId,
    appSettings.general.startup_restore,
    appSettings.general.startup_restore_window_layout,
    settingsLoaded,
    startupRestoreComplete,
    tabs,
    uiConfig.terminal_window_layout,
  ]);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (!startupRestoreComplete) return;
    if (!terminalWindowsRestoredRef.current) return;
    if (!terminalWindowsHydratedRef.current) return;
    if (tabs.length > 0 && !terminalWindows) return;
    persistTerminalWindowLayout(terminalWindows, tabs);
  }, [persistTerminalWindowLayout, settingsLoaded, startupRestoreComplete, tabs, terminalWindows]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<AIOpenIntent>).detail;
      if (!detail) return;
      setAiIntent(detail);
      openPanel("aiAssistant", "right");
    };
    window.addEventListener(AI_OPEN_EVENT, handler);
    return () => window.removeEventListener(AI_OPEN_EVENT, handler);
  }, [openPanel]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<NoteOpenDetail>).detail;
      if (!detail?.noteId) return;
      openNoteTab(detail.noteId, detail.title);
    };
    window.addEventListener(NOTE_OPEN_EVENT, handler);
    return () => window.removeEventListener(NOTE_OPEN_EVENT, handler);
  }, [openNoteTab]);

  const { unreadTabIds, disconnectedTabIds } = useTabStatusIndicators(tabs, activeTabId);

  const handleSelectLeafTab = useCallback(
    (leafId: string, tabId: string) => {
      preserveRestoredLeafActiveTabsRef.current = false;
      restoredGlobalActiveTabIdRef.current = null;
      setTerminalWindows((current) =>
        current ? setLeafActiveTab(current, leafId, tabId) : current,
      );
      setActiveTabId(tabId);
    },
    [setActiveTabId],
  );

  const handleAddTabFromLeaf = useCallback(
    (leafId: string) => {
      const targetLeaf = terminalWindows
        ? findTerminalWindowLeafById(terminalWindows, leafId)
        : null;
      if (targetLeaf?.activeTabId) {
        handleSelectLeafTab(leafId, targetLeaf.activeTabId);
      }
      openNewSessionWithTarget(undefined, undefined, {
        targetLeafId: leafId,
        anchorTabId:
          targetLeaf?.activeTabId ?? targetLeaf?.tabIds[targetLeaf.tabIds.length - 1] ?? null,
      });
    },
    [handleSelectLeafTab, terminalWindows],
  );

  const handleConnectConnectionFromLeaf = useCallback(
    async (leafId: string, connection: SavedConnection) => {
      if (shouldLaunchExternalRemoteDesktop(connection)) {
        await connectSavedConnection(connection);
        return;
      }

      const targetLeaf = terminalWindows
        ? findTerminalWindowLeafById(terminalWindows, leafId)
        : null;
      const anchorTabId =
        targetLeaf?.activeTabId ?? targetLeaf?.tabIds[targetLeaf.tabIds.length - 1] ?? null;

      if (targetLeaf?.activeTabId) {
        handleSelectLeafTab(leafId, targetLeaf.activeTabId);
      }

      const pending = addPendingTab(
        connection.name,
        getConnectionSessionType(connection),
        connection.id,
        undefined,
        anchorTabId ? { afterTabId: anchorTabId } : undefined,
        { display: getRemoteDesktopPaneDisplay(connection) },
      );
      const { tabId, createRequestId } = pending;

      if (targetLeaf) {
        setTerminalWindows((current) =>
          current
            ? insertTabIntoLeaf(current, leafId, tabId, {
                afterTabId: anchorTabId,
                activeTabId: tabId,
              })
            : current,
        );
      }

      try {
        const sessionId = await createSessionForConnection(connection, createRequestId);
        if (!hasTab(tabId)) {
          await closeStaleCreatedSession(sessionId);
          return;
        }
        updateTabSession(tabId, sessionId);
        recordRecentConnection(connection.id);
        updateAutoIconForSessionStart(connection.id, sessionId);
      } catch (error) {
        if (isSessionCreationCancelled(error) || !hasTab(tabId)) {
          return;
        }
        const errorMessage = getErrorMessage(error);
        logger.error({
          domain: "session.lifecycle",
          event: "connection.open_failed",
          message: "Connection failed from tab menu",
          ids: { connection_id: connection.id },
          error,
        });
        markTabConnectionFailed(tabId, errorMessage);
        maybePromptConnectionEdit(connection.id, errorMessage, {
          sourceTabId: tabId,
        });
        toast.error(t("savedConnections.connectionFailed", { error: errorMessage }));
      }
    },
    [
      addPendingTab,
      connectSavedConnection,
      hasTab,
      handleSelectLeafTab,
      markTabConnectionFailed,
      maybePromptConnectionEdit,
      recordRecentConnection,
      t,
      terminalWindows,
      updateAutoIconForSessionStart,
      updateTabSession,
    ],
  );

  const handleReorderHeaderTabs = useCallback((fromTabId: string, toIndex: number) => {
    preserveRestoredLeafActiveTabsRef.current = false;
    restoredGlobalActiveTabIdRef.current = null;
    setTerminalWindows((current) =>
      current ? reorderTabsGlobally(current, fromTabId, toIndex) : current,
    );
  }, []);

  const handleSelectHeaderTab = useCallback(
    (tabId: string) => {
      if (!terminalWindows) {
        setActiveTabId(tabId);
        return;
      }
      const leaf = findTerminalWindowLeafByTabId(terminalWindows, tabId);
      if (leaf) {
        handleSelectLeafTab(leaf.id, tabId);
        return;
      }
      setActiveTabId(tabId);
    },
    [handleSelectLeafTab, setActiveTabId, terminalWindows],
  );

  const handleAddHeaderTab = useCallback(() => {
    if (!terminalWindows) {
      openNewSessionWithTarget();
      return;
    }
    const leaf =
      (activeTabId ? findTerminalWindowLeafByTabId(terminalWindows, activeTabId) : null) ??
      getFirstTerminalWindowLeaf(terminalWindows);
    handleAddTabFromLeaf(leaf.id);
  }, [activeTabId, handleAddTabFromLeaf, openNewSessionWithTarget, terminalWindows]);

  const handleConnectConnectionFromHeader = useCallback(
    async (connection: SavedConnection) => {
      if (!terminalWindows) {
        await connectSavedConnection(connection);
        return;
      }
      const leaf =
        (activeTabId ? findTerminalWindowLeafByTabId(terminalWindows, activeTabId) : null) ??
        getFirstTerminalWindowLeaf(terminalWindows);
      await handleConnectConnectionFromLeaf(leaf.id, connection);
    },
    [activeTabId, connectSavedConnection, handleConnectConnectionFromLeaf, terminalWindows],
  );

  const handleMoveTabToLeaf = useCallback(
    (fromTabId: string, targetLeafId: string, toIndex: number) => {
      preserveRestoredLeafActiveTabsRef.current = false;
      restoredGlobalActiveTabIdRef.current = null;
      setTerminalWindows((current) => {
        if (!current) return current;
        const next = moveTabBetweenLeaves(current, fromTabId, targetLeafId, toIndex);
        return next ?? current;
      });
      setActiveTabId(fromTabId);
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent("nyaterm:refresh-terminals"));
      });
    },
    [setActiveTabId],
  );

  const handleSplitTabToLeaf = useCallback(
    (fromTabId: string, targetLeafId: string, direction: SplitEdgeDirection) => {
      preserveRestoredLeafActiveTabsRef.current = false;
      restoredGlobalActiveTabIdRef.current = null;
      setTerminalWindows((current) => {
        if (!current) return current;
        const next = splitLeafWithTab(current, fromTabId, targetLeafId, direction);
        return next ?? current;
      });
      setActiveTabId(fromTabId);
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent("nyaterm:refresh-terminals"));
      });
    },
    [setActiveTabId],
  );

  const handleUnsplit = useCallback(() => {
    preserveRestoredLeafActiveTabsRef.current = false;
    restoredGlobalActiveTabIdRef.current = null;
    setTerminalWindows((current) => {
      if (!current) return current;
      return flattenTerminalWindows(current, activeTabId);
    });
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("nyaterm:refresh-terminals"));
    });
  }, [activeTabId]);

  const handleUpdateWindowSplitRatio = useCallback((splitId: string, ratio: number) => {
    setTerminalWindows((current) =>
      current ? updateTerminalWindowSplitRatio(current, splitId, ratio) : current,
    );
  }, []);

  const handleActivatePane = useCallback(
    (tabId: string, paneId: string) => {
      preserveRestoredLeafActiveTabsRef.current = false;
      restoredGlobalActiveTabIdRef.current = null;
      setActiveTabId(tabId);
      setActivePane(tabId, paneId);
    },
    [setActivePane, setActiveTabId],
  );

  const handleUpdatePaneSplitRatio = useCallback(
    (tabId: string, splitId: string, ratio: number) => {
      updateSplitRatio(tabId, splitId, ratio);
    },
    [updateSplitRatio],
  );

  const closePaneBackendSession = useCallback(
    async (
      pane: Pick<
        SessionPane,
        "connecting" | "connectError" | "sessionId" | "createRequestId" | "type" | "view"
      >,
    ) => {
      const storageInvalidate = storageWorkspaceInvalidate(pane.sessionId);
      if (
        storageInvalidate ||
        pane.view === "s3" ||
        pane.view === "ftp" ||
        pane.view === "webdav" ||
        pane.type === "S3" ||
        pane.type === "FTP" ||
        pane.type === "WebDAV"
      ) {
        if (storageInvalidate) {
          clearFileExplorerSessionCacheForSession(pane.sessionId);
          clearDirectoryChildrenCacheForSession(pane.sessionId);
          await invoke(storageInvalidate.command, {
            connection_id: storageInvalidate.connectionId,
          }).catch(() => {});
        }
        return true;
      }

      if (pane.connecting) {
        if (pane.view === "workbench" || pane.view === "note" || pane.view === "externalMarkdown") {
          return true;
        }
        if (pane.type === "RDP") {
          await invoke("close_rdp_session", {
            sessionId: pane.sessionId,
          }).catch(() => {});
          return true;
        }
        if (pane.type === "VNC") {
          await invoke("close_vnc_session", {
            sessionId: pane.sessionId,
          }).catch(() => {});
          return true;
        }
        if (pane.createRequestId) {
          try {
            await invoke("cancel_session_creation", {
              createRequestId: pane.createRequestId,
            });
          } catch (error) {
            logger.error({
              domain: "session.lifecycle",
              event: "session.creation_cancel_failed",
              message: "Failed to cancel session creation",
              data: { create_request_id: pane.createRequestId },
              error,
            });
          }
        }
        return true;
      }

      if (pane.connectError) {
        return true;
      }

      if (pane.view === "workbench" || pane.view === "note" || pane.view === "externalMarkdown") {
        return true;
      }

      try {
        if (pane.type === "RDP") {
          await invoke("close_rdp_session", { sessionId: pane.sessionId });
          return true;
        }
        if (pane.type === "VNC") {
          await invoke("close_vnc_session", { sessionId: pane.sessionId });
          return true;
        }
        await flushAssetMonitoringCache(pane.sessionId);
        await attachSessionBeforeClose(pane.sessionId);
        await invoke("close_session", { sessionId: pane.sessionId });
        clearSessionCommandHistory(pane.sessionId);
        setSyncGroups((prev) => purgeSessionFromGroups(pane.sessionId, prev));
        return true;
      } catch (error) {
        logger.error({
          domain: "session.lifecycle",
          event: "session.close_failed",
          message: "Failed to close session",
          ids: { session_id: pane.sessionId },
          error,
        });
        return false;
      }
    },
    [flushAssetMonitoringCache, setSyncGroups],
  );

  const closeReleasedSessions = useCallback(
    async (previousTabs: Tab[], nextTabs: Tab[]) => {
      const releasedSessionIds = getReleasedSessionIds(previousTabs, nextTabs);
      const results = await Promise.all(
        releasedSessionIds.map((sessionId) => {
          const pane = previousTabs
            .flatMap((tab) => collectSessionPanes(tab.root))
            .find((candidate) => candidate.sessionId === sessionId);
          return pane ? closePaneBackendSession(pane) : Promise.resolve(true);
        }),
      );
      return results.every(Boolean);
    },
    [closePaneBackendSession],
  );

  const persistWorkspaceNow = useCallback(
    async (message: string) => {
      try {
        await persistTabsNow();
        return true;
      } catch (error) {
        logger.error({
          domain: "settings.persistence",
          event: "workspace_tabs.persist_failed",
          message: "Failed to persist workspace tabs",
          error,
        });
        toast.error(message);
        return false;
      }
    },
    [persistTabsNow],
  );

  const notifyLockedTabCloseBlocked = useCallback(() => {
    toast.info(t("tabCtx.lockedCloseBlocked"));
  }, [t]);

  const executeCloseTabs = useCallback(
    async (tabIds: string[], options?: { nextActiveTabId?: string | null }) => {
      const targetIds = new Set(tabIds);
      const nextTabs = tabs.filter((tab) => !targetIds.has(tab.id));
      const allClosed = await closeReleasedSessions(tabs, nextTabs);
      if (!allClosed) {
        toast.error(t("tabCtx.closeFailed"));
        return;
      }
      closeTabs(tabIds, options);
      await persistWorkspaceNow(t("tabCtx.closeFailed"));
    },
    [closeReleasedSessions, closeTabs, persistWorkspaceNow, t, tabs],
  );

  const requestCloseTabs = useCallback(
    async (tabsToClose: Tab[], options?: { nextActiveTabId?: string | null }) => {
      const tabIds = tabsToClose.map((tab) => tab.id);
      const paneIds = collectFileDocumentPaneIds(tabsToClose);
      await requestFileDocumentClose(paneIds, () => executeCloseTabs(tabIds, options));
    },
    [executeCloseTabs, requestFileDocumentClose],
  );

  const executeClosePane = useCallback(
    async (tabId: string, paneId: string) => {
      const nextTabs = removePaneFromTabs(tabs, tabId, paneId);
      const allClosed = await closeReleasedSessions(tabs, nextTabs);
      if (!allClosed) {
        toast.error(t("tabCtx.closeFailed"));
        return;
      }
      closePane(tabId, paneId);
      await persistWorkspaceNow(t("tabCtx.closeFailed"));
    },
    [closePane, closeReleasedSessions, persistWorkspaceNow, t, tabs],
  );

  const requestClosePane = useCallback(
    async (tab: Tab, pane: SessionPane) => {
      const paneIds = pane.paneKind === "file" ? [pane.id] : [];
      await requestFileDocumentClose(paneIds, () => executeClosePane(tab.id, pane.id));
    },
    [executeClosePane, requestFileDocumentClose],
  );

  const handleCloseWorkspaceTab = useCallback(
    async (tab: Tab) => {
      if (tab.locked) {
        notifyLockedTabCloseBlocked();
        return;
      }
      await requestCloseTabs([tab]);
    },
    [notifyLockedTabCloseBlocked, requestCloseTabs],
  );

  const handleCloseDisconnectedPane = useCallback(
    async (tabId: string, paneId: string) => {
      const tab = tabs.find((item) => item.id === tabId);
      const pane = tab ? findSessionPaneById(tab.root, paneId) : null;
      if (!tab || !pane) return;
      if (tab.locked) {
        notifyLockedTabCloseBlocked();
        return;
      }
      await requestClosePane(tab, pane);
    },
    [notifyLockedTabCloseBlocked, requestClosePane, tabs],
  );

  const handleSessionClick = useCallback(
    (sessionId: string) => {
      const tab = findTabBySessionId(tabs, sessionId);
      const pane = tab ? findPaneBySessionId(tab, sessionId) : null;
      if (tab && pane) {
        setTerminalWindows((current) => {
          const leaf = current ? findTerminalWindowLeafByTabId(current, tab.id) : null;
          return current && leaf ? setLeafActiveTab(current, leaf.id, tab.id) : current;
        });
        setActiveTabId(tab.id);
        setActivePane(tab.id, pane.id);
      }
    },
    [tabs, setActivePane, setActiveTabId],
  );

  const getQuickCommandPeerSessionIds = useCallback(
    (sessionId: string) => {
      return getSessionInputPeerIds(sessionId, syncGroups, tabs, broadcastToAll);
    },
    [broadcastToAll, syncGroups, tabs],
  );

  const handleHistoryCommand = useCallback(
    (command: string, execute: boolean = true) => {
      if (activePane?.paneKind !== "terminal" || !hasLiveSession(activePane)) return;

      const { sessionId } = activePane;
      const data = buildTerminalCommandInput(command, execute);
      const options = {
        preview: execute
          ? ({ kind: "reset" } as const)
          : ({ kind: "data", data: command } as const),
        registerSubmission: execute ? command : null,
      };
      const peerSessionIds = getQuickCommandPeerSessionIds(sessionId);
      const sendInput =
        peerSessionIds.length > 0
          ? sendSessionInputWithSync(sessionId, data, peerSessionIds, options)
          : sendSessionInput(sessionId, data, options);

      void sendInput.catch(() => {});
      import("@tauri-apps/api/event").then(({ emit }) => {
        emit(`focus-terminal-${sessionId}`);
      });
    },
    [activePane, getQuickCommandPeerSessionIds],
  );

  const handleSendToAllSessions = useCallback(
    (command: string, execute: boolean = true) => {
      const data = buildTerminalCommandInput(command, execute);
      for (const tab of tabs) {
        for (const pane of collectSessionPanes(tab.root)) {
          if (
            pane.paneKind !== "terminal" ||
            !hasLiveSession(pane) ||
            !isNonSerialSessionType(pane.type)
          ) {
            continue;
          }
          const { sessionId } = pane;
          void sendSessionInput(sessionId, data, {
            preview: execute ? { kind: "reset" } : { kind: "data", data: command },
            registerSubmission: execute ? command : null,
          }).catch(() => {});
        }
      }
    },
    [tabs],
  );

  const handleReconnected = useCallback(
    (oldSessionId: string, newSessionId: string) => {
      const tab = findTabBySessionId(tabs, oldSessionId);
      const pane = tab ? findPaneBySessionId(tab, oldSessionId) : null;
      if (!pane) return;
      replaceSessionReferences(oldSessionId, newSessionId);
      updateAutoIconForSessionStart(pane.connectionId, newSessionId);
    },
    [replaceSessionReferences, tabs, updateAutoIconForSessionStart],
  );

  const handleConnectionError = useCallback(
    (tabId: string, paneId: string, sessionId: string, error: string) => {
      const tab = tabs.find((item) => item.id === tabId);
      const pane = tab ? findSessionPaneById(tab.root, paneId) : null;
      if (!pane || pane.sessionId !== sessionId || pane.connectError) return;
      markPaneConnectionFailed(tabId, paneId, error);
    },
    [markPaneConnectionFailed, tabs],
  );

  // --- Shortcut callbacks ---

  const handleNewLocalTerminal = useCallback(() => {
    if (!isLocked) {
      setShowLocalShellPicker(true);
    }
  }, [isLocked]);

  const handleCloseActiveTab = useCallback(() => {
    if (!activeTab) return;
    if (activeTab.locked) {
      notifyLockedTabCloseBlocked();
      return;
    }
    void handleCloseWorkspaceTab(activeTab);
  }, [activeTab, handleCloseWorkspaceTab, notifyLockedTabCloseBlocked]);

  const getActiveLeafTabIds = useCallback(() => {
    const leaf =
      terminalWindows && activeTabId
        ? findTerminalWindowLeafByTabId(terminalWindows, activeTabId)
        : null;
    return leaf?.tabIds ?? tabs.map((tab) => tab.id);
  }, [activeTabId, tabs, terminalWindows]);

  const handleNextTab = useCallback(() => {
    if (!activeTabId) return;
    const tabIds = getActiveLeafTabIds();
    if (tabIds.length < 2) return;
    const idx = tabIds.indexOf(activeTabId);
    if (idx === -1) return;
    setActiveTabId(tabIds[(idx + 1) % tabIds.length]);
  }, [activeTabId, getActiveLeafTabIds, setActiveTabId]);

  const handlePrevTab = useCallback(() => {
    if (!activeTabId) return;
    const tabIds = getActiveLeafTabIds();
    if (tabIds.length < 2) return;
    const idx = tabIds.indexOf(activeTabId);
    if (idx === -1) return;
    setActiveTabId(tabIds[(idx - 1 + tabIds.length) % tabIds.length]);
  }, [activeTabId, getActiveLeafTabIds, setActiveTabId]);

  const handleSwitchTab = useCallback(
    (index: number) => {
      const tabIds = getActiveLeafTabIds();
      const targetTabId = index === -1 ? tabIds[tabIds.length - 1] : tabIds[index];
      if (targetTabId) setActiveTabId(targetTabId);
    },
    [getActiveLeafTabIds, setActiveTabId],
  );

  const handleToggleLeftSidebar = useCallback(() => {
    if (panelOpenMode === "floating") {
      if (floatingPanels.left) {
        closeFloatingPanel("left");
        return;
      }
      const first = getVisibleActivityIds(
        [...uiConfig.activity_bar_layout.left_top, ...uiConfig.activity_bar_layout.left_bottom],
        uiConfig,
      ).find(canUseFloatingPanel);
      if (first) handleFloatingPanelSelect(first, "left");
      return;
    }
    updateUi((prev) => {
      const activityBarHidden = !prev.activity_bar_layout.show_left;
      if (activityBarHidden) {
        const first = getVisibleActivityIds(
          [...prev.activity_bar_layout.left_top, ...prev.activity_bar_layout.left_bottom],
          prev,
        ).find((id) => !NON_PANEL_IDS.has(id));
        if (prev.active_left_panel || (prev.left_open_panels?.length ?? 0) > 0) {
          return {
            activity_bar_layout: {
              ...prev.activity_bar_layout,
              show_left: true,
            },
          };
        }
        if (!first) {
          return {
            activity_bar_layout: {
              ...prev.activity_bar_layout,
              show_left: true,
            },
          };
        }
        return {
          activity_bar_layout: {
            ...prev.activity_bar_layout,
            show_left: true,
          },
          ...(EXCLUSIVE_PANEL_IDS.has(first)
            ? { active_left_panel: first }
            : { left_open_panels: [first], active_left_panel: first }),
        };
      }
      if (multiPanelOpen) {
        if ((prev.left_open_panels?.length ?? 0) > 0 || prev.active_left_panel) {
          return { left_open_panels: [], active_left_panel: null };
        }
        const first = getVisibleActivityIds(
          [...prev.activity_bar_layout.left_top, ...prev.activity_bar_layout.left_bottom],
          prev,
        ).find((id) => !NON_PANEL_IDS.has(id));
        if (!first) return {};
        return EXCLUSIVE_PANEL_IDS.has(first)
          ? { active_left_panel: first }
          : { left_open_panels: [first], active_left_panel: first };
      }
      if (prev.active_left_panel) return { active_left_panel: null };
      const first = getVisibleActivityIds(
        [...prev.activity_bar_layout.left_top, ...prev.activity_bar_layout.left_bottom],
        prev,
      ).find((id) => !NON_PANEL_IDS.has(id));
      return { active_left_panel: first ?? null };
    });
  }, [
    closeFloatingPanel,
    floatingPanels.left,
    handleFloatingPanelSelect,
    multiPanelOpen,
    panelOpenMode,
    uiConfig,
    updateUi,
  ]);

  const handleToggleRightSidebar = useCallback(() => {
    if (panelOpenMode === "floating") {
      if (floatingPanels.right) {
        closeFloatingPanel("right");
        return;
      }
      const first = getVisibleActivityIds(
        [...uiConfig.activity_bar_layout.right_top, ...uiConfig.activity_bar_layout.right_bottom],
        uiConfig,
      ).find(canUseFloatingPanel);
      if (first) handleFloatingPanelSelect(first, "right");
      return;
    }
    updateUi((prev) => {
      const activityBarHidden = !prev.activity_bar_layout.show_right;
      if (activityBarHidden) {
        const first = getVisibleActivityIds(
          [...prev.activity_bar_layout.right_top, ...prev.activity_bar_layout.right_bottom],
          prev,
        ).find((id) => !NON_PANEL_IDS.has(id));
        if (prev.active_right_panel || (prev.right_open_panels?.length ?? 0) > 0) {
          return {
            activity_bar_layout: {
              ...prev.activity_bar_layout,
              show_right: true,
            },
          };
        }
        if (!first) {
          return {
            activity_bar_layout: {
              ...prev.activity_bar_layout,
              show_right: true,
            },
          };
        }
        return {
          activity_bar_layout: {
            ...prev.activity_bar_layout,
            show_right: true,
          },
          ...(EXCLUSIVE_PANEL_IDS.has(first)
            ? { active_right_panel: first }
            : { right_open_panels: [first], active_right_panel: first }),
        };
      }
      if (multiPanelOpen) {
        if ((prev.right_open_panels?.length ?? 0) > 0 || prev.active_right_panel) {
          return { right_open_panels: [], active_right_panel: null };
        }
        const first = getVisibleActivityIds(
          [...prev.activity_bar_layout.right_top, ...prev.activity_bar_layout.right_bottom],
          prev,
        ).find((id) => !NON_PANEL_IDS.has(id));
        if (!first) return {};
        return EXCLUSIVE_PANEL_IDS.has(first)
          ? { active_right_panel: first }
          : { right_open_panels: [first], active_right_panel: first };
      }
      if (prev.active_right_panel) return { active_right_panel: null };
      const first = getVisibleActivityIds(
        [...prev.activity_bar_layout.right_top, ...prev.activity_bar_layout.right_bottom],
        prev,
      ).find((id) => !NON_PANEL_IDS.has(id));
      return { active_right_panel: first ?? null };
    });
  }, [
    closeFloatingPanel,
    floatingPanels.right,
    handleFloatingPanelSelect,
    multiPanelOpen,
    panelOpenMode,
    uiConfig,
    updateUi,
  ]);

  const { handleZoomIn, handleZoomOut, handleResetZoom } = useTerminalZoom(
    updateAppSettings,
    appSettings.keybindings,
    appSettings.interaction.terminal_zoom_enabled,
  );

  const handleOpenSettings = useCallback(() => {
    openSettings();
  }, []);

  const handleLockScreen = useCallback(() => {
    if (appSettings.security.enable_screen_lock) {
      setIsLocked(true);
    }
  }, [appSettings.security.enable_screen_lock, setIsLocked]);

  const persistWorkspaceLayoutNow = useCallback(async () => {
    if (!settingsLoaded || !startupRestoreComplete || !terminalWindowsRestoredRef.current) {
      await persistTabsNow();
      return;
    }

    const restorableTabs = tabsRef.current.filter((tab) =>
      collectSessionPanes(tab.root).some((pane) => pane.paneKind !== "file"),
    );
    const terminalWindowLayout =
      appSettings.general.startup_restore_window_layout === false
        ? null
        : serializeTerminalWindowLayout(terminalWindowsRef.current, restorableTabs);
    lastPersistedTerminalWindowLayoutKeyRef.current = JSON.stringify(terminalWindowLayout ?? null);
    await persistTabsNow({ terminal_window_layout: terminalWindowLayout });
  }, [
    appSettings.general.startup_restore_window_layout,
    persistTabsNow,
    settingsLoaded,
    startupRestoreComplete,
  ]);

  const handleQuitApplication = useCallback(() => {
    setShowQuitConfirm(false);
    void requestFileDocumentClose(collectFileDocumentPaneIds(tabs), async () => {
      await persistWorkspaceLayoutNow().catch((error) => {
        logger.error({
          domain: "settings.persistence",
          event: "workspace_layout.persist_before_quit_failed",
          message: "Failed to persist workspace layout before quit",
          error,
        });
      });
      await invoke<void>("quit_application");
    });
  }, [persistWorkspaceLayoutNow, requestFileDocumentClose, tabs]);

  useEffect(() => {
    if (!settingsLoaded) return;
    let unlistenCloseRequested: (() => void) | undefined;

    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        const currentWindow = getCurrentWindow();
        return currentWindow.onCloseRequested(async (event) => {
          if (allowProgrammaticWindowCloseRef.current) return;

          event.preventDefault();

          if (appSettings.general.minimize_to_tray) {
            await persistWorkspaceLayoutNow().catch((error) => {
              logger.error({
                domain: "settings.persistence",
                event: "workspace_layout.persist_before_close_failed",
                message: "Failed to persist workspace layout before close",
                error,
              });
            });
            await invoke<void>("hide_main_window").catch(() => {});
            return;
          }

          if (tabs.length > 0 && appSettings.general.confirm_on_close !== false) {
            setShowQuitConfirm(true);
            return;
          }

          await requestFileDocumentClose(collectFileDocumentPaneIds(tabs), async () => {
            await persistWorkspaceLayoutNow().catch((error) => {
              logger.error({
                domain: "settings.persistence",
                event: "workspace_layout.persist_before_close_failed",
                message: "Failed to persist workspace layout before close",
                error,
              });
            });
            allowProgrammaticWindowCloseRef.current = true;
            await currentWindow.close().catch(() => {
              allowProgrammaticWindowCloseRef.current = false;
            });
            window.setTimeout(() => {
              allowProgrammaticWindowCloseRef.current = false;
            }, 1000);
          });
        });
      })
      .then((unlisten) => {
        unlistenCloseRequested = unlisten;
      })
      .catch(() => {});

    return () => {
      unlistenCloseRequested?.();
    };
  }, [
    appSettings.general.confirm_on_close,
    appSettings.general.minimize_to_tray,
    persistWorkspaceLayoutNow,
    requestFileDocumentClose,
    settingsLoaded,
    tabs,
  ]);

  const handleRequestQuit = useCallback(() => {
    if (tabs.length > 0 && appSettings.general.confirm_on_close !== false) {
      setShowQuitConfirm(true);
      return;
    }

    handleQuitApplication();
  }, [appSettings.general.confirm_on_close, handleQuitApplication, tabs.length]);

  const handleRequestWindowClose = useCallback(() => {
    if (
      !appSettings.general.minimize_to_tray &&
      tabs.length > 0 &&
      appSettings.general.confirm_on_close !== false
    ) {
      setShowQuitConfirm(true);
      return;
    }

    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().close(),
    );
  }, [appSettings.general.confirm_on_close, appSettings.general.minimize_to_tray, tabs.length]);

  useEffect(() => {
    const unlisten = listen<TrayAction>("tray-action", ({ payload }) => {
      if (!eventTargetsCurrentWindow(payload.targetWindowLabel)) return;
      if (isLocked && payload.type !== "lock_screen" && payload.type !== "request_quit") {
        return;
      }

      switch (payload.type) {
        case "open_new_session":
          handleNewSession();
          break;
        case "focus_session":
          handleSessionClick(payload.sessionId);
          break;
        case "open_panel":
          handleOpenPanel(payload.panelId);
          break;
        case "open_settings":
          handleOpenSettings();
          break;
        case "lock_screen":
          handleLockScreen();
          break;
        case "check_updates":
          setShowUpdateDialog(true);
          break;
        case "request_quit":
          handleRequestQuit();
          break;
      }
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, [
    handleLockScreen,
    handleNewSession,
    handleOpenPanel,
    handleOpenSettings,
    handleRequestQuit,
    handleSessionClick,
    isLocked,
  ]);

  // --- Tab context-menu callbacks ---

  const handleDuplicateSession = useCallback(
    async (tab: Tab, startupCommand?: StartupCommandRequest) => {
      const pane = getActivePane(tab);
      if (!canCreateSessionFromPane(pane)) return;

      try {
        const pending = addPendingTab(
          pane.name,
          pane.type,
          pane.connectionId,
          { customName: tab.customName, tabColor: tab.tabColor },
          { afterTabId: tab.id },
          { temporaryConfig: pane.temporaryConfig },
        );
        const { tabId, createRequestId } = pending;
        setTerminalWindows((current) =>
          current ? insertTabAfterInLeaf(current, tab.id, tabId, tabId) : current,
        );
        try {
          const sessionId = await createSessionForPane(pane, createRequestId, startupCommand);
          if (!hasTab(tabId)) {
            await closeStaleCreatedSession(sessionId);
            return;
          }
          updateTabSession(tabId, sessionId);
          if (startupCommand && pane.type !== "SSH" && pane.type !== "Telnet") {
            void sendStartupCommandToSession(sessionId, startupCommand).catch((error) => {
              logger.error({
                domain: "session.lifecycle",
                event: "session.startup_command_failed",
                message: "Failed to send startup command to duplicated session",
                ids: { session_id: sessionId },
                error,
              });
              toast.error(t("tabCtx.duplicateFailed"));
            });
          }
          if (pane.connectionId) {
            recordRecentConnection(pane.connectionId);
            updateAutoIconForSessionStart(pane.connectionId, sessionId);
          }
        } catch (error) {
          if (isSessionCreationCancelled(error) || !hasTab(tabId)) {
            return;
          }
          const errorMessage = getErrorMessage(error);
          logger.error({
            domain: "session.lifecycle",
            event: "session.duplicate_failed",
            message: "Failed to duplicate session",
            ids: pane.connectionId ? { connection_id: pane.connectionId } : undefined,
            error,
          });
          markTabConnectionFailed(tabId, errorMessage);
          maybePromptConnectionEdit(pane.connectionId, errorMessage, {
            sourceTabId: tabId,
          });
          toast.error(t("tabCtx.duplicateFailed"));
        }
      } catch (error) {
        logger.error({
          domain: "ui.error",
          event: "tab.duplicate_failed",
          message: "Failed to create duplicated tab",
          error,
        });
        toast.error(t("tabCtx.duplicateFailed"));
      }
    },
    [
      addPendingTab,
      hasTab,
      markTabConnectionFailed,
      maybePromptConnectionEdit,
      recordRecentConnection,
      t,
      updateAutoIconForSessionStart,
      updateTabSession,
    ],
  );

  const handleMultiplexSshSession = useCallback(
    async (tab: Tab, startupCommand?: StartupCommandRequest) => {
      const pane = getActivePane(tab);
      if (
        !pane ||
        pane.paneKind !== "terminal" ||
        pane.type !== "SSH" ||
        pane.connecting ||
        pane.connectError
      ) {
        return;
      }

      let tabId: string | undefined;

      try {
        const pending = addPendingTab(
          pane.name,
          pane.type,
          pane.connectionId,
          { customName: tab.customName, tabColor: tab.tabColor },
          { afterTabId: tab.id },
          { temporaryConfig: pane.temporaryConfig },
        );
        tabId = pending.tabId;
        setTerminalWindows((current) =>
          current && tabId ? insertTabAfterInLeaf(current, tab.id, tabId, tabId) : current,
        );

        const sessionId = await invoke<string>("create_multiplexed_ssh_session", {
          sourceSessionId: pane.sessionId,
          startupCommand: buildStartupCommandPayload(startupCommand),
        });
        if (!hasTab(tabId)) {
          await closeStaleCreatedSession(sessionId);
          return;
        }
        updateTabSession(tabId, sessionId);
        if (pane.connectionId) {
          recordRecentConnection(pane.connectionId);
          updateAutoIconForSessionStart(pane.connectionId, sessionId);
        }
      } catch (error) {
        if ((tabId && !hasTab(tabId)) || isSessionCreationCancelled(error)) {
          return;
        }
        const errorMessage = getErrorMessage(error);
        logger.error({
          domain: "session.lifecycle",
          event: "session.multiplex_failed",
          message: "Failed to create multiplexed SSH session",
          ids: pane.connectionId
            ? { connection_id: pane.connectionId, session_id: pane.sessionId }
            : { session_id: pane.sessionId },
          error,
        });
        if (tabId) {
          markTabConnectionFailed(tabId, errorMessage);
        }
        toast.error(t("tabCtx.multiplexSshFailed"));
      }
    },
    [
      addPendingTab,
      hasTab,
      markTabConnectionFailed,
      recordRecentConnection,
      t,
      updateAutoIconForSessionStart,
      updateTabSession,
    ],
  );

  const handleDuplicateSessionWithCommand = useCallback(
    (tab: Tab, command: string, delayMs: number) =>
      handleDuplicateSession(tab, { command, delayMs }),
    [handleDuplicateSession],
  );

  const handleMultiplexSshSessionWithCommand = useCallback(
    (tab: Tab, command: string, delayMs: number) =>
      handleMultiplexSshSession(tab, { command, delayMs }),
    [handleMultiplexSshSession],
  );

  const handleMultiplexSshSftpSession = useCallback(
    async (tab: Tab) => {
      const pane = getActivePane(tab);
      if (!pane || pane.type !== "SSH" || pane.connecting || pane.connectError || !pane.sessionId) {
        return;
      }

      if (pane.connectionId) {
        const connection = savedConnections.find((item) => item.id === pane.connectionId);
        if (connection?.sftp?.enabled === false) {
          toast.error(t("savedConnections.openSftpDisabled"));
          return;
        }
      }

      let tabId: string | undefined;

      try {
        const tabName = t("sftpWorkspace.tabTitle", { name: pane.name });
        const pending = addPendingTab(
          tabName,
          pane.type,
          pane.connectionId,
          { tabColor: tab.tabColor },
          { afterTabId: tab.id, view: "sftp" },
        );
        tabId = pending.tabId;
        setTerminalWindows((current) =>
          current && tabId ? insertTabAfterInLeaf(current, tab.id, tabId, tabId) : current,
        );

        const sessionId = await invoke<string>("create_multiplexed_ssh_session", {
          sourceSessionId: pane.sessionId,
        });
        if (!hasTab(tabId)) {
          await closeStaleCreatedSession(sessionId);
          return;
        }
        updateTabSession(tabId, sessionId);
        if (pane.connectionId) {
          recordRecentConnection(pane.connectionId);
          updateAutoIconForSessionStart(pane.connectionId, sessionId);
        }
      } catch (error) {
        if ((tabId && !hasTab(tabId)) || isSessionCreationCancelled(error)) {
          return;
        }
        const errorMessage = getErrorMessage(error);
        logger.error({
          domain: "session.lifecycle",
          event: "session.multiplex_sftp_failed",
          message: "Failed to create multiplexed SFTP session",
          ids: pane.connectionId
            ? { connection_id: pane.connectionId, session_id: pane.sessionId }
            : { session_id: pane.sessionId },
          error,
        });
        if (tabId) {
          markTabConnectionFailed(tabId, errorMessage);
        }
        toast.error(t("tabCtx.multiplexSshSftpFailed"));
      }
    },
    [
      addPendingTab,
      hasTab,
      markTabConnectionFailed,
      recordRecentConnection,
      savedConnections,
      t,
      updateAutoIconForSessionStart,
      updateTabSession,
    ],
  );

  const getActiveTab = useCallback(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, tabs],
  );

  const handleDuplicateActiveSession = useCallback(() => {
    const tab = getActiveTab();
    if (tab) void handleDuplicateSession(tab);
  }, [getActiveTab, handleDuplicateSession]);

  const handleMultiplexActiveSshSession = useCallback(() => {
    const tab = getActiveTab();
    if (tab) void handleMultiplexSshSession(tab);
  }, [getActiveTab, handleMultiplexSshSession]);

  const handleDuplicateActiveSessionWithCommand = useCallback(() => {
    const tab = getActiveTab();
    if (!tab) return;
    window.dispatchEvent(
      new CustomEvent("nyaterm:open-tab-startup-command-dialog", {
        detail: { tabId: tab.id, action: "duplicate" },
      }),
    );
  }, [getActiveTab]);

  const handleMultiplexActiveSshSessionWithCommand = useCallback(() => {
    const tab = getActiveTab();
    if (!tab) return;
    window.dispatchEvent(
      new CustomEvent("nyaterm:open-tab-startup-command-dialog", {
        detail: { tabId: tab.id, action: "multiplex" },
      }),
    );
  }, [getActiveTab]);

  const hasFileDocumentDependency = useCallback(
    (sessionId: string) =>
      tabs.some((tab) =>
        collectSessionPanes(tab.root).some(
          (pane) => pane.paneKind === "file" && pane.sessionId === sessionId,
        ),
      ),
    [tabs],
  );

  const notifyFileDocumentDependency = useCallback(() => {
    toast.info(t("tabCtx.fileSessionInUse"));
  }, [t]);

  const handleReconnectSession = useCallback(
    async (tab: Tab) => {
      const pane = getActivePane(tab);
      if (!pane || pane.connecting || !canCreateSessionFromPane(pane)) return;
      if (hasFileDocumentDependency(pane.sessionId)) {
        notifyFileDocumentDependency();
        return;
      }

      toast.info(t("tabCtx.reconnecting"));

      try {
        if (pane.connectionId) {
          await invoke("mark_tunnels_reconnecting_for_connection", {
            connectionId: pane.connectionId,
          }).catch(() => {});
        }
        const reconnectContent = capturePaneReconnectContent(pane);
        const closed = await closePaneBackendSession(pane);
        if (!closed) {
          throw new Error("close_session_failed");
        }

        const newSessionId = await createSessionForPane(pane);
        if (!hasPane(tab.id, pane.id)) {
          await closeStaleCreatedSession(newSessionId);
          return;
        }
        preserveTerminalReconnectContent(newSessionId, reconnectContent);
        updatePaneSession(tab.id, pane.id, newSessionId);
        if (pane.connectionId) {
          recordRecentConnection(pane.connectionId);
          updateAutoIconForSessionStart(pane.connectionId, newSessionId);
        }
        toast.success(t("tabCtx.reconnectSuccess"));
      } catch (error) {
        if (isSessionCreationCancelled(error) || !hasPane(tab.id, pane.id)) {
          return;
        }
        const errorMessage = getErrorMessage(error);
        if (pane.connectionId) {
          await invoke("mark_tunnels_disconnected_for_connection", {
            connectionId: pane.connectionId,
          }).catch(() => {});
        }
        logger.error({
          domain: "session.lifecycle",
          event: "session.reconnect_failed",
          message: "Failed to reconnect session",
          ids: pane.connectionId ? { connection_id: pane.connectionId } : undefined,
          error,
        });
        maybePromptConnectionEdit(pane.connectionId, errorMessage, {
          sourceTabId: tab.id,
          sourcePaneId: pane.id,
        });
        toast.error(t("tabCtx.reconnectFailed"));
      }
    },
    [
      closePaneBackendSession,
      hasFileDocumentDependency,
      hasPane,
      maybePromptConnectionEdit,
      notifyFileDocumentDependency,
      recordRecentConnection,
      t,
      updateAutoIconForSessionStart,
      updatePaneSession,
    ],
  );

  const handleDisconnectSession = useCallback(
    async (tab: Tab) => {
      const pane = getActivePane(tab);
      if (!pane || pane.connecting || pane.connectError || pane.paneKind === "file") return;
      if (hasFileDocumentDependency(pane.sessionId)) {
        notifyFileDocumentDependency();
        return;
      }

      const closed = await closePaneBackendSession(pane);
      if (!closed) {
        toast.error(t("tabCtx.disconnectFailed"));
        return;
      }

      toast.success(t("tabCtx.disconnectSuccess"));
    },
    [closePaneBackendSession, hasFileDocumentDependency, notifyFileDocumentDependency, t],
  );

  const handleReconnectSessionById = useCallback(
    async (sessionId: string) => {
      const tab = findTabBySessionId(tabs, sessionId);
      const pane = tab ? findPaneBySessionId(tab, sessionId) : null;
      if (!tab || !pane || pane.connecting || !canCreateSessionFromPane(pane)) return;
      if (hasFileDocumentDependency(pane.sessionId)) {
        notifyFileDocumentDependency();
        return;
      }

      toast.info(t("tabCtx.reconnecting"));

      try {
        if (pane.connectionId) {
          await invoke("mark_tunnels_reconnecting_for_connection", {
            connectionId: pane.connectionId,
          }).catch(() => {});
        }
        const reconnectContent = capturePaneReconnectContent(pane);
        const closed = await closePaneBackendSession(pane);
        if (!closed) {
          throw new Error("close_session_failed");
        }

        const newSessionId = await createSessionForPane(pane);
        if (!hasPane(tab.id, pane.id)) {
          await closeStaleCreatedSession(newSessionId);
          return;
        }
        preserveTerminalReconnectContent(newSessionId, reconnectContent);
        updatePaneSession(tab.id, pane.id, newSessionId);
        if (pane.connectionId) {
          recordRecentConnection(pane.connectionId);
          updateAutoIconForSessionStart(pane.connectionId, newSessionId);
        }
        toast.success(t("tabCtx.reconnectSuccess"));
      } catch (error) {
        if (isSessionCreationCancelled(error) || !hasPane(tab.id, pane.id)) {
          return;
        }
        const errorMessage = getErrorMessage(error);
        if (pane.connectionId) {
          await invoke("mark_tunnels_disconnected_for_connection", {
            connectionId: pane.connectionId,
          }).catch(() => {});
        }
        logger.error({
          domain: "session.lifecycle",
          event: "session.reconnect_failed",
          message: "Failed to reconnect session from active sessions panel",
          ids: pane.connectionId ? { connection_id: pane.connectionId } : undefined,
          error,
        });
        maybePromptConnectionEdit(pane.connectionId, errorMessage, {
          sourceTabId: tab.id,
          sourcePaneId: pane.id,
        });
        toast.error(t("tabCtx.reconnectFailed"));
      }
    },
    [
      closePaneBackendSession,
      hasFileDocumentDependency,
      hasPane,
      maybePromptConnectionEdit,
      notifyFileDocumentDependency,
      recordRecentConnection,
      t,
      tabs,
      updateAutoIconForSessionStart,
      updatePaneSession,
    ],
  );

  const handleSplitSession = useCallback(
    async (tab: Tab, direction: PaneSplitDirection) => {
      const pane = getActivePane(tab);
      if (!pane || pane.view === "sftp" || pane.paneKind === "file" || !canCreateSessionFromPane(pane))
        return;
      const leaf = terminalWindows
        ? findTerminalWindowLeafByTabId(terminalWindows, tab.id)
        : null;

      if (!leaf) {
        toast.error(t("tabCtx.splitFailed"));
        return;
      }

      if (leaf.tabIds.length > 1) {
        setTerminalWindows((current) =>
          current ? splitTerminalWindowForTab(current, tab.id, direction) : current,
        );
        setActiveTabId(tab.id);
        window.dispatchEvent(new CustomEvent("nyaterm:refresh-terminals"));
        return;
      }

      let newTabId: string | undefined;

      try {
        const pending = addPendingTab(
          pane.name,
          pane.type,
          pane.connectionId,
          { customName: tab.customName, tabColor: tab.tabColor },
          { afterTabId: tab.id },
          { temporaryConfig: pane.temporaryConfig },
        );
        newTabId = pending.tabId;
        setTerminalWindows((current) =>
          current ? splitTerminalWindowForTab(current, tab.id, direction, newTabId) : current,
        );
        const sessionId = await createSessionForPane(pane, pending.createRequestId);
        if (newTabId) {
          if (!hasTab(newTabId)) {
            await closeStaleCreatedSession(sessionId);
            return;
          }
          updateTabSession(newTabId, sessionId);
        }
        if (pane.connectionId) {
          recordRecentConnection(pane.connectionId);
          updateAutoIconForSessionStart(pane.connectionId, sessionId);
        }
        window.dispatchEvent(new CustomEvent("nyaterm:refresh-terminals"));
      } catch (error) {
        if ((newTabId && !hasTab(newTabId)) || isSessionCreationCancelled(error)) {
          return;
        }
        const errorMessage = getErrorMessage(error);
        logger.error({
          domain: "session.lifecycle",
          event: "session.split_failed",
          message: "Failed to create split session",
          ids: pane.connectionId ? { connection_id: pane.connectionId } : undefined,
          error,
        });
        if (newTabId) {
          markTabConnectionFailed(newTabId, errorMessage);
        }
        maybePromptConnectionEdit(
          pane.connectionId,
          errorMessage,
          newTabId ? { sourceTabId: newTabId } : undefined,
        );
        toast.error(t("tabCtx.splitFailed"));
      }
    },
    [
      addPendingTab,
      hasTab,
      markTabConnectionFailed,
      maybePromptConnectionEdit,
      recordRecentConnection,
      setActiveTabId,
      t,
      terminalWindows,
      updateAutoIconForSessionStart,
      updateTabSession,
    ],
  );

  const handleSmartSplit = useCallback(
    (mode: SmartSplitMode) => {
      const tabIds = tabs.map((tab) => tab.id);
      if (tabIds.length === 0) return;

      const layout = buildSmartSplitLayout(tabIds, mode);
      if (layout) {
        setTerminalWindows(layout);
        window.dispatchEvent(new CustomEvent("nyaterm:refresh-terminals"));
      }
    },
    [tabs],
  );

  const handleReconnectPane = useCallback(
    async (tabId: string, paneId: string) => {
      const tab = tabs.find((item) => item.id === tabId);
      const pane = tab
        ? (collectSessionPanes(tab.root).find((item) => item.id === paneId) ?? null)
        : null;
      if (!pane || pane.connecting || !canCreateSessionFromPane(pane)) return;
      if (hasFileDocumentDependency(pane.sessionId)) {
        notifyFileDocumentDependency();
        return;
      }

      try {
        if (pane.connectionId) {
          await invoke("mark_tunnels_reconnecting_for_connection", {
            connectionId: pane.connectionId,
          }).catch(() => {});
        }
        const reconnectContent = capturePaneReconnectContent(pane);
        const closed = await closePaneBackendSession(pane);
        if (!closed) {
          throw new Error("close_session_failed");
        }

        const newSessionId = await createSessionForPane(pane);
        if (!hasPane(tabId, paneId)) {
          await closeStaleCreatedSession(newSessionId);
          return;
        }
        preserveTerminalReconnectContent(newSessionId, reconnectContent);
        updatePaneSession(tabId, paneId, newSessionId);
        if (pane.connectionId) {
          recordRecentConnection(pane.connectionId);
          updateAutoIconForSessionStart(pane.connectionId, newSessionId);
        }
      } catch (error) {
        if (isSessionCreationCancelled(error) || !hasPane(tabId, paneId)) {
          return;
        }
        const errorMessage = getErrorMessage(error);
        if (pane.connectionId) {
          await invoke("mark_tunnels_disconnected_for_connection", {
            connectionId: pane.connectionId,
          }).catch(() => {});
        }
        logger.error({
          domain: "session.lifecycle",
          event: "session.reconnect_failed",
          message: "Failed to reconnect pane",
          ids: pane.connectionId ? { connection_id: pane.connectionId } : undefined,
          error,
        });
        if (pane.connectError) {
          markPaneConnectionFailed(tabId, paneId, errorMessage);
        }
        maybePromptConnectionEdit(pane.connectionId, errorMessage, {
          sourceTabId: tabId,
          sourcePaneId: paneId,
        });
      }
    },
    [
      closePaneBackendSession,
      hasFileDocumentDependency,
      hasPane,
      markPaneConnectionFailed,
      maybePromptConnectionEdit,
      notifyFileDocumentDependency,
      recordRecentConnection,
      tabs,
      updateAutoIconForSessionStart,
      updatePaneSession,
    ],
  );

  const handleCloseSession = useCallback(
    async (tab: Tab) => {
      if (tab.locked) {
        notifyLockedTabCloseBlocked();
        return;
      }

      const pane = getActivePane(tab);
      if (!pane) return;
      await requestClosePane(tab, pane);
    },
    [notifyLockedTabCloseBlocked, requestClosePane],
  );

  const handleDisconnectSessionById = useCallback(
    async (sessionId: string) => {
      const tab = findTabBySessionId(tabs, sessionId);
      const pane = tab ? findPaneBySessionId(tab, sessionId) : null;

      if (pane && hasFileDocumentDependency(sessionId)) {
        notifyFileDocumentDependency();
        return;
      }

      if (!tab || !pane) {
        try {
          await attachSessionBeforeClose(sessionId);
          await invoke("close_session", { sessionId });
          clearSessionCommandHistory(sessionId);
        } catch (error) {
          logger.error({
            domain: "session.lifecycle",
            event: "session.close_failed",
            message: "Failed to disconnect session outside workspace",
            ids: { session_id: sessionId },
            error,
          });
          toast.error(t("tabCtx.closeFailed"));
        }
        return;
      }

      await requestClosePane(tab, pane);
    },
    [hasFileDocumentDependency, notifyFileDocumentDependency, requestClosePane, t, tabs],
  );

  const canReconnectSessionById = useCallback(
    (sessionId: string) => {
      const tab = findTabBySessionId(tabs, sessionId);
      const pane = tab ? findPaneBySessionId(tab, sessionId) : null;
      return (
        !!pane &&
        pane.paneKind !== "file" &&
        !pane.connecting &&
        !hasFileDocumentDependency(sessionId) &&
        canCreateSessionFromPane(pane)
      );
    },
    [hasFileDocumentDependency, tabs],
  );

  const handleCloseAllTabs = useCallback(async () => {
    const tabsToClose = tabs.filter((tab) => !tab.locked);
    const skippedLockedCount = tabs.length - tabsToClose.length;
    if (tabsToClose.length > 0) await requestCloseTabs(tabsToClose);
    if (skippedLockedCount > 0) toast.info(t("tabCtx.lockedTabsSkipped"));
  }, [requestCloseTabs, t, tabs]);

  const handleCloseInactiveTabs = useCallback(
    async (keepTabId: string) => {
      const tabOrder = terminalWindows
        ? flattenLeafTabs(terminalWindows, tabsById).map((tab) => tab.id)
        : tabs.map((tab) => tab.id);
      const targetTabsToClose = tabs.filter(
        (tab) => tabOrder.includes(tab.id) && tab.id !== keepTabId,
      );
      const tabsToClose = targetTabsToClose.filter((tab) => !tab.locked);
      const skippedLockedCount = targetTabsToClose.length - tabsToClose.length;

      if (tabsToClose.length > 0) {
        await requestCloseTabs(tabsToClose, { nextActiveTabId: keepTabId });
      } else if (activeTabId !== keepTabId) {
        setActiveTabId(keepTabId);
      }

      if (skippedLockedCount > 0) toast.info(t("tabCtx.lockedTabsSkipped"));
    },
    [activeTabId, requestCloseTabs, setActiveTabId, t, tabs, tabsById, terminalWindows],
  );

  const handleCloseRightTabs = useCallback(
    async (tabId: string) => {
      const tabOrder = terminalWindows
        ? flattenLeafTabs(terminalWindows, tabsById).map((tab) => tab.id)
        : tabs.map((tab) => tab.id);
      const idx = tabOrder.indexOf(tabId);
      if (idx === -1) return;

      const rightTabIds = tabOrder.slice(idx + 1);
      const targetTabsToClose = tabs.filter((tab) => rightTabIds.includes(tab.id));
      const tabsToClose = targetTabsToClose.filter((tab) => !tab.locked);
      const skippedLockedCount = targetTabsToClose.length - tabsToClose.length;

      if (tabsToClose.length > 0) await requestCloseTabs(tabsToClose);
      if (skippedLockedCount > 0) toast.info(t("tabCtx.lockedTabsSkipped"));
    },
    [requestCloseTabs, t, tabs, tabsById, terminalWindows],
  );

  const handleSessionInfo = useCallback((tab: Tab) => {
    const pane = getActivePane(tab);
    if (pane?.connectionId) {
      openNewSession(pane.connectionId);
    }
  }, []);

  const handleOpenChat = useCallback(() => {
    if (!isLocked) {
      openPanel("aiAssistant", "right");
    }
  }, [isLocked, openPanel]);

  const handleShowAllCommands = useCallback(() => {
    if (!isLocked) {
      updateUi((prev) => ({
        show_quick_cmd_bar: !prev.show_quick_cmd_bar,
        ...(prev.show_serial_send_panel ? { show_serial_send_panel: false } : {}),
      }));
    }
  }, [isLocked, updateUi]);

  const handleOpenSessionSwitcher = useCallback(() => {
    if (!isLocked) {
      setSessionSwitcherScope("all");
      setShowSessionQuickSwitcher(true);
    }
  }, [isLocked]);

  const handleOpenConnectionQuickOpen = useCallback(() => {
    if (!isLocked) {
      setSessionSwitcherScope("connections");
      setShowSessionQuickSwitcher(true);
    }
  }, [isLocked]);

  const handleOpenTemporarySshLink = useCallback(() => {
    if (!isLocked) {
      setShowTemporarySshLink(true);
    }
  }, [isLocked]);

  const handleTemporarySshConnect = useCallback(
    async (config: TemporaryLinkConfig) => {
      await connectTemporaryConnection(config);
    },
    [connectTemporaryConnection],
  );

  const buildRecordingFilePath = useCallback(
    async (prefix: "recording" | "session", sessionName: string) => {
      const dir = appSettings.recording.base_path || (await downloadDir());
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      return joinPath(dir, `${prefix}-${safeRecordingName(sessionName)}-${timestamp}.log`);
    },
    [appSettings.recording.base_path],
  );

  const handleToggleSessionRecordingById = useCallback(
    async (sessionId: string, mode: RecordingMode = "transcript") => {
      const isActive = recordingSessions.has(sessionId);

      if (isActive) {
        try {
          const savedPath = await invoke<string>("stop_recording", {
            sessionId,
          });
          await refreshRecordingStatuses();
          toast.success(t("recording.saved", { path: savedPath }));
        } catch (error) {
          logger.error({
            domain: "session.lifecycle",
            event: "recording.stop_failed",
            message: "Failed to stop recording",
            ids: { session_id: sessionId },
            error,
          });
          toast.error(t("recording.stopFailed"));
        }
        return;
      }

      try {
        await invoke<string>("start_recording", {
          request: {
            sessionId,
            mode,
            explicitPath: null,
          },
        });
        await refreshRecordingStatuses();
        toast.success(t("recording.started"));
      } catch (error) {
        logger.error({
          domain: "session.lifecycle",
          event: "recording.start_failed",
          message: "Failed to start recording",
          ids: { session_id: sessionId },
          error,
        });
        toast.error(t("recording.startFailed"));
      }
    },
    [refreshRecordingStatuses, recordingSessions, t],
  );

  const handleToggleSessionRecording = useCallback(
    async (session: SessionInfo, mode: RecordingMode = "transcript") => {
      await handleToggleSessionRecordingById(session.id, mode);
    },
    [handleToggleSessionRecordingById],
  );

  const handleToggleActiveSessionRecording = useCallback(() => {
    if (isLocked || !activePane || activePane.connecting || activePane.connectError) {
      return;
    }
    void handleToggleSessionRecordingById(activePane.sessionId, "transcript");
  }, [activePane, handleToggleSessionRecordingById, isLocked]);

  useGlobalShortcuts(
    {
      onNewSession: () => handleNewSession(),
      onTemporarySshLink: handleOpenTemporarySshLink,
      onOpenSessionSwitcher: handleOpenSessionSwitcher,
      onNewLocalTerminal: handleNewLocalTerminal,
      onCloseTab: handleCloseActiveTab,
      onDuplicateSession: handleDuplicateActiveSession,
      onMultiplexSsh: handleMultiplexActiveSshSession,
      onDuplicateSessionWithCommand: handleDuplicateActiveSessionWithCommand,
      onMultiplexSshWithCommand: handleMultiplexActiveSshSessionWithCommand,
      onNextTab: handleNextTab,
      onPrevTab: handlePrevTab,
      onSwitchTab: handleSwitchTab,
      onToggleLeftSidebar: handleToggleLeftSidebar,
      onToggleRightSidebar: handleToggleRightSidebar,
      onZoomIn: handleZoomIn,
      onZoomOut: handleZoomOut,
      onResetZoom: handleResetZoom,
      onOpenSettings: handleOpenSettings,
      onOpenChat: handleOpenChat,
      onShowAllCommands: handleShowAllCommands,
      onLockScreen: handleLockScreen,
      onManageSyncGroups: () => setShowSyncGroupDialog(true),
      onClearTerminal: () => window.dispatchEvent(new CustomEvent("nyaterm:clear-terminal")),
      onToggleRecording: handleToggleActiveSessionRecording,
    },
    appSettings.keybindings,
  );

  const handleSaveSessionTranscript = useCallback(
    async (session: SessionInfo) => {
      try {
        const filePath = await buildRecordingFilePath("session", session.name);
        const savedPath = await invoke<string>("save_session_transcript", {
          sessionId: session.id,
          filePath,
          includeIoLabels: appSettings.recording.include_io_labels,
          includeTimestamps: appSettings.recording.include_timestamps ?? true,
        });
        toast.success(t("recording.transcriptSaved", { path: savedPath }));
      } catch (error) {
        logger.error({
          domain: "session.lifecycle",
          event: "recording.transcript_save_failed",
          message: "Failed to save session transcript",
          ids: { session_id: session.id },
          error,
        });
        toast.error(t("recording.saveFailed"));
      }
    },
    [
      appSettings.recording.include_io_labels,
      appSettings.recording.include_timestamps,
      buildRecordingFilePath,
      t,
    ],
  );

  const handleSaveSessionTranscriptById = useCallback(
    async (sessionId: string, sessionName?: string) => {
      const session = liveSessionsById?.get(sessionId);
      await handleSaveSessionTranscript({
        id: sessionId,
        name: session?.name ?? sessionName ?? sessionId,
        session_type: session?.session_type ?? "Local",
        started_at: session?.started_at ?? new Date().toISOString(),
        connection_id: session?.connection_id ?? null,
        connected: session?.connected ?? true,
        owner_window_label: session?.owner_window_label ?? null,
        ai_execution_profile: session?.ai_execution_profile ?? "auto",
        injection_active: session?.injection_active ?? false,
        remote_file_browser_enabled: session?.remote_file_browser_enabled ?? false,
        remote_stats_enabled: session?.remote_stats_enabled ?? false,
        ssh_profile: session?.ssh_profile ?? null,
      });
    },
    [handleSaveSessionTranscript, liveSessionsById],
  );

  // Resize handlers
  const handleLeftResize = useCallback(
    (delta: number) => {
      updateUi((prev) => ({
        left_width: Math.max(160, Math.min(720, (prev.left_width || 306) + delta)),
      }));
    },
    [updateUi],
  );

  const handleRightResize = useCallback(
    (delta: number) => {
      updateUi((prev) => ({
        right_width: Math.max(200, Math.min(720, (prev.right_width || 306) - delta)),
      }));
    },
    [updateUi],
  );

  const handleQuickCmdResize = useCallback(
    (delta: number) => {
      updateUi((prev) => ({
        quick_cmd_height: Math.max(36, Math.min(520, (prev.quick_cmd_height || 180) - delta)),
      }));
    },
    [updateUi],
  );

  const handleSerialSendResize = useCallback(
    (delta: number) => {
      updateUi((prev) => ({
        serial_send_height: Math.max(60, Math.min(520, (prev.serial_send_height || 180) - delta)),
      }));
    },
    [updateUi],
  );

  const {
    leftTopItems,
    leftBottomItems,
    rightTopItems,
    rightBottomItems,
    showLabelsLeft,
    showLabelsRight,
    showLeft: showLeftActivityBar,
    showRight: showRightActivityBar,
    leftHiddenItems,
    rightHiddenItems,
    toggleActiveIds,
    handleItemSelect,
    handleReorder,
    handleMoveItem,
    handleToggleLabel,
    handleToggleVisibility,
    handleSetVisibility,
    handleHideItem,
    handleShowItem,
    handleToggleItemVisibility,
    handleResetActivityBarLayout,

  } = useActivityBarController({
    uiConfig,
    recordingSessions,
    multiPanelOpen,
    panelOpenMode,
    onFloatingPanelSelect: handleFloatingPanelSelect,
    onFloatingPanelMove: handleFloatingPanelMove,
    updateUi,
    setIsLocked,
    t,
  });

  // --- Panel content rendering (side-independent) ---

  const activeSessionId =
    activePane &&
    activePane.paneKind === "terminal" &&
    !activePane.connecting &&
    !activePane.connectError
      ? activePane.sessionId
      : null;
  const activeSshSessionId =
    activePane &&
    activePane.paneKind === "terminal" &&
    !activePane.connecting &&
    !activePane.connectError &&
    activePane.type === "SSH"
      ? activePane.sessionId
      : null;
  const activeLiveSshSessionId =
    activeSshSessionId && (liveSessionIds === null || liveSessionIds.has(activeSshSessionId))
      ? activeSshSessionId
      : null;
  const activeLiveSshSessionInfo = activeLiveSshSessionId
    ? liveSessionsById?.get(activeLiveSshSessionId)
    : null;
  const activeStatsSessionId =
    activeLiveSshSessionId && (activeLiveSshSessionInfo?.remote_stats_enabled ?? true)
      ? activeLiveSshSessionId
      : null;
  const activeRemoteStatsEnabled = remoteStatsEnabled && Boolean(activeStatsSessionId);
  const remoteStats = useRemoteStats(
    activeLiveSshSessionId,
    activeRemoteStatsEnabled,
    uiConfig.remote_stats_interval ?? 3,
  );
  const headerStatusMode = normalizeHeaderStatusMode(uiConfig.header_status_mode);
  const headerStatusVisible = uiConfig.header_status_visible !== false;
  const gpuOverviewEnabled =
    (uiConfig.show_gpu_monitor ?? false) || (headerStatusVisible && headerStatusMode === "gpu");
  const npuOverviewEnabled =
    (uiConfig.show_ascend_npu_monitor ?? false) ||
    (headerStatusVisible && headerStatusMode === "npu");
  const gpuOverviewState = useRemoteGpuOverview(
    activeLiveSshSessionId,
    gpuOverviewEnabled && Boolean(activeStatsSessionId),
    uiConfig.gpu_monitor_interval ?? 3,
  );
  const npuOverviewState = useRemoteNpuOverview(
    activeLiveSshSessionId,
    npuOverviewEnabled && Boolean(activeStatsSessionId),
    uiConfig.ascend_npu_monitor_interval ?? 3,
  );

  useEffect(() => {
    if (!activeStatsSessionId || !remoteStats.stats) return;

    const patch = buildAssetPatchFromRemoteStats(remoteStats.stats);
    if (patch) {
      handleAssetMonitoringPatch(activeStatsSessionId, patch);
    }
  }, [activeStatsSessionId, handleAssetMonitoringPatch, remoteStats.stats]);
  useEffect(() => {
    if (!activeStatsSessionId || !gpuOverviewState.overview) return;

    const patch = buildAssetPatchFromGpuOverview(gpuOverviewState.overview);
    if (patch) {
      handleAssetMonitoringPatch(activeStatsSessionId, patch);
    }
  }, [activeStatsSessionId, gpuOverviewState.overview, handleAssetMonitoringPatch]);
  useEffect(() => {
    if (!activeStatsSessionId || !npuOverviewState.overview) return;

    const patch = buildAssetPatchFromNpuOverview(npuOverviewState.overview);
    if (patch) {
      handleAssetMonitoringPatch(activeStatsSessionId, patch);
    }
  }, [activeStatsSessionId, handleAssetMonitoringPatch, npuOverviewState.overview]);

  const activeSerialSessionId =
    activePane &&
    activePane.paneKind === "terminal" &&
    !activePane.connecting &&
    !activePane.connectError &&
    activePane.type === "Serial"
      ? activePane.sessionId
      : null;
  const activeNonSerialSessionId =
    activePane &&
    activePane.paneKind === "terminal" &&
    !activePane.connecting &&
    !activePane.connectError &&
    isNonSerialSessionType(activePane.type)
      ? activePane.sessionId
      : null;
  const activeNonSerialSessionIds = useMemo(
    () => collectActiveNonSerialSessionIds(terminalWindows, tabsById),
    [tabsById, terminalWindows],
  );
  const sendCommandSessionTargets = useMemo(() => {
    const currentWindowLabel = getOwnerMainWindowLabel();
    const targetsById = new Map<
      string,
      {
        id: string;
        name: string;
        tabName: string;
        type: SessionType;
        ownerWindowLabel?: string | null;
      }
    >();

    if (terminalWindows) {
      const visit = (node: TerminalWindowNode) => {
        if (node.kind === "split") {
          visit(node.first);
          visit(node.second);
          return;

        }

        for (const tabId of node.tabIds) {
          const tab = tabsById.get(tabId);
          if (!tab) continue;

          for (const pane of collectSessionPanes(tab.root)) {
            if (
              pane.paneKind !== "terminal" ||
              pane.type === "S3" ||
              pane.type === "FTP" ||
              pane.type === "WebDAV" ||
              pane.view === "s3" ||
              pane.view === "ftp" ||
              pane.view === "webdav" ||
              !hasLiveSession(pane)
            ) {
              continue;
            }
            targetsById.set(pane.sessionId, {
              id: pane.sessionId,
              name: pane.name,
              tabName: getTabDisplayName(tab),
              type: pane.type,
              ownerWindowLabel: currentWindowLabel,
            });
          }
        }
      };

      visit(terminalWindows);
    }

    for (const session of liveSessionsById?.values() ?? []) {
      if (!["SSH", "Local", "Telnet", "Serial"].includes(session.session_type)) continue;
      if (targetsById.has(session.id)) continue;
      targetsById.set(session.id, {
        id: session.id,
        name: session.name,
        tabName: session.name,
        type: session.session_type as SessionType,
        ownerWindowLabel: session.owner_window_label ?? null,
      });
    }

    return [...targetsById.values()];
  }, [liveSessionsById, tabsById, terminalWindows]);

  const activeBottomPanel = uiConfig.show_serial_send_panel
    ? "serialSend"
    : uiConfig.show_quick_cmd_bar
      ? "quickCmdBar"
      : null;
  const temporarySshShortcut = resolveDisplayKeys("tab.temporarySshLink", appSettings.keybindings);
  const openChatShortcut = resolveDisplayKeys("view.openChat", appSettings.keybindings);
  const showCommandsShortcut = resolveDisplayKeys("view.showAllCommands", appSettings.keybindings);
  const switchTerminalShortcut = resolveDisplayKeys("tab.quickSwitch", appSettings.keybindings);

  const quickSwitcherSessions = useMemo<QuickSwitcherSession[]>(() => {
    const connectionsById = new Map(
      savedConnections.map((connection) => [connection.id, connection]),
    );
    const sessions: QuickSwitcherSession[] = [];
    for (const tab of tabs) {
      for (const pane of collectSessionPanes(tab.root)) {
        if (pane.paneKind !== "terminal" || pane.type === "S3" || pane.type === "FTP" || pane.type === "WebDAV" || pane.view === "s3" || pane.view === "ftp" || pane.view === "webdav") continue;
        const connection = pane.connectionId ? connectionsById.get(pane.connectionId) : undefined;
        sessions.push({
          id: pane.sessionId,
          name: pane.name,
          sessionType: pane.type,
          connectionName: connection?.name,
          tabName: getTabDisplayName(tab),
          connecting: pane.connecting,
          connectError: pane.connectError,
        });
      }
    }
    return sessions;
  }, [savedConnections, tabs]);

  const handleCloseSessionQuickSwitcher = useCallback(() => {
    setShowSessionQuickSwitcher(false);
    setSessionSwitcherScope("all");
    focusTerminalSession(activeSessionId);
  }, [activeSessionId]);

  const handleCloseLocalShellPicker = useCallback(() => {
    setShowLocalShellPicker(false);
    focusTerminalSession(activeSessionId);
  }, [activeSessionId]);

  const handleSelectLocalShell = useCallback(
    (shell: LocalShellSelection) => {
      setShowLocalShellPicker(false);
      const tabName = shell.elevated
        ? `${shell.name} (${t("localShellPicker.admin")})`
        : shell.name || t("menu.newLocalTerminal");
      const pending = beginPendingSession(tabName, "Local");
      const { tabId, paneId, createRequestId } = pending;

      invoke<string>("create_local_session", {
        shellPath: shell.shellPath,
        shellArgs: shell.shellArgs,
        name: tabName,
        elevated: shell.elevated,
        createRequestId,
      })
        .then(async (sessionId) => {
          if (paneId ? !hasPane(tabId, paneId) : !hasTab(tabId)) {
            await closeStaleCreatedSession(sessionId);
            return;
          }
          if (paneId) {
            updatePaneSession(tabId, paneId, sessionId);
          } else {
            updateTabSession(tabId, sessionId);
          }
          focusTerminalSession(sessionId);
        })
        .catch((e) => {
          if (isSessionCreationCancelled(e)) return;
          if (paneId) {
            markPaneConnectionFailed(tabId, paneId, getErrorMessage(e));
          } else if (hasTab(tabId)) {
            markTabConnectionFailed(tabId, getErrorMessage(e));
          }
          logger.error({
            domain: "session.lifecycle",
            event: "session.create_failed",
            message: "Failed to create local session",
            data: {
              session_type: "Local",
              shell_path: shell.shellPath,
              elevated: shell.elevated,
            },
            error: e,
          });
        });
    },
    [
      beginPendingSession,
      hasPane,
      hasTab,
      markPaneConnectionFailed,
      markTabConnectionFailed,
      t,
      updatePaneSession,
      updateTabSession,
    ],
  );

  const handleQuickSwitchSession = useCallback(
    (sessionId: string) => {
      handleSessionClick(sessionId);
      setShowSessionQuickSwitcher(false);
      setSessionSwitcherScope("all");
      focusTerminalSession(sessionId);
    },
    [handleSessionClick],
  );

  const handleQuickOpenConnection = useCallback(
    async (connection: SavedConnection) => {
      setShowSessionQuickSwitcher(false);
      setSessionSwitcherScope("all");
      await connectSavedConnection(connection, {
        failureContext: "Connection failed from quick switcher",
      });
    },
    [connectSavedConnection],
  );

  const handleQuickSwitcherNewSshSession = useCallback(() => {
    setShowSessionQuickSwitcher(false);
    setSessionSwitcherScope("all");
    openNewSession(undefined, true);
  }, []);

  const handleTransferResize = useCallback(
    (delta: number) => {
      updateUi((prev) => ({
        transfer_height: Math.max(60, Math.min(600, (prev.transfer_height || 180) - delta)),
      }));
    },
    [updateUi],
  );

  const leftPanelIds = useMemo(
    () => getSideOpenPanels(uiConfig, "left", multiPanelOpen),
    [multiPanelOpen, uiConfig],
  );
  const rightPanelIds = useMemo(
    () => getSideOpenPanels(uiConfig, "right", multiPanelOpen),
    [multiPanelOpen, uiConfig],
  );
  const leftOverlayPanelId = useMemo(
    () => getSideOverlayPanel(uiConfig, "left", multiPanelOpen),
    [multiPanelOpen, uiConfig],
  );
  const rightOverlayPanelId = useMemo(
    () => getSideOverlayPanel(uiConfig, "right", multiPanelOpen),
    [multiPanelOpen, uiConfig],
  );
  const leftActiveIds = useMemo(
    () => (multiPanelOpen ? new Set(leftPanelIds) : undefined),
    [leftPanelIds, multiPanelOpen],
  );
  const rightActiveIds = useMemo(
    () => (multiPanelOpen ? new Set(rightPanelIds) : undefined),
    [multiPanelOpen, rightPanelIds],
  );
  const dockedLeftPanelIds = panelOpenMode === "floating" ? [] : leftPanelIds;
  const dockedRightPanelIds = panelOpenMode === "floating" ? [] : rightPanelIds;
  const dockedLeftOverlayPanelId = panelOpenMode === "floating" ? null : leftOverlayPanelId;
  const dockedRightOverlayPanelId = panelOpenMode === "floating" ? null : rightOverlayPanelId;
  const visibleFloatingPanels =
    panelOpenMode === "floating" ? floatingPanels : { left: null, right: null };
  const leftActivityActiveIds = useMemo(() => {
    if (panelOpenMode !== "floating") return leftActiveIds;
    return floatingPanels.left ? new Set([floatingPanels.left]) : undefined;
  }, [floatingPanels.left, leftActiveIds, panelOpenMode]);
  const rightActivityActiveIds = useMemo(() => {
    if (panelOpenMode !== "floating") return rightActiveIds;
    return floatingPanels.right ? new Set([floatingPanels.right]) : undefined;
  }, [floatingPanels.right, panelOpenMode, rightActiveIds]);

  useEffect(() => {
    if (panelOpenMode !== "floating") return;
    const next = clearUnavailableFloatingPanels(floatingPanels, uiConfig);
    if (next === floatingPanels) return;
    setFloatingPanels(next);
    setLastFloatingSide((current) => {
      if (current && next[current]) return current;
      return next.right ? "right" : next.left ? "left" : null;
    });
  }, [floatingPanels, panelOpenMode, uiConfig]);

  useEffect(() => {
    if (panelOpenMode !== "floating") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (isLocked || modalChildWindowCount > 0) return;
      if (
        showAbout ||
        showUpdateDialog ||
        showSyncGroupDialog ||
        showQuitConfirm ||
        showActivityBarResetConfirm ||
        showSessionQuickSwitcher ||
        showTemporarySshLink ||
        Boolean(externalMatchDialog) ||
        Boolean(postLoginConfirm) ||
        Boolean(pendingFileDocumentClose) ||
        Boolean(activeHostKeyRequest) ||
        Boolean(activeSshAgentRequest) ||
        Boolean(activeOtpRequest) ||
        Boolean(activeSshAuthRequest) ||
        Boolean(dockerSudoPasswordRequest) ||
        rdpCertificateRequests.length > 0
      ) {
        return;
      }

      const sideToClose =
        lastFloatingSide && floatingPanels[lastFloatingSide]
          ? lastFloatingSide
          : floatingPanels.right
            ? "right"
            : floatingPanels.left
              ? "left"
              : null;
      if (!sideToClose) return;
      event.preventDefault();
      closeFloatingPanel(sideToClose);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeHostKeyRequest,
    activeOtpRequest,
    activeSshAgentRequest,
    activeSshAuthRequest,
    closeFloatingPanel,
    dockerSudoPasswordRequest,
    externalMatchDialog,
    floatingPanels,
    isLocked,
    lastFloatingSide,
    modalChildWindowCount,
    panelOpenMode,
    pendingFileDocumentClose,
    postLoginConfirm,
    rdpCertificateRequests.length,
    showAbout,
    showActivityBarResetConfirm,
    showQuitConfirm,
    showSessionQuickSwitcher,
    showSyncGroupDialog,
    showTemporarySshLink,
    showUpdateDialog,
  ]);

  // When multi-open mode is first enabled, seed the stacks from the active panels.
  useEffect(() => {
    if (!settingsLoaded || !multiPanelOpen || panelOpenMode === "floating") return;
    updateUi((prev) => ({
      ...((prev.left_open_panels?.length ?? 0) === 0 &&
      prev.active_left_panel &&
      isActivityItemAvailable(prev.active_left_panel, prev) &&
      !EXCLUSIVE_PANEL_IDS.has(prev.active_left_panel)
        ? { left_open_panels: [prev.active_left_panel] }
        : {}),
      ...((prev.right_open_panels?.length ?? 0) === 0 &&
      prev.active_right_panel &&
      isActivityItemAvailable(prev.active_right_panel, prev) &&
      !EXCLUSIVE_PANEL_IDS.has(prev.active_right_panel)
        ? { right_open_panels: [prev.active_right_panel] }
        : {}),
    }));
  }, [multiPanelOpen, panelOpenMode, settingsLoaded, updateUi]);

  const handlePanelStackResize = useCallback(
    (
      side: "left" | "right",
      aboveId: string,
      belowId: string,
      delta: number,
      containerHeight: number,
    ) => {
      updateUi((prev) => {
        const openIds = getSideOpenPanels(prev, side, true);
        const sizes = prev.panel_stack_sizes ?? {};
        const totalWeight = openIds.reduce((sum, id) => sum + (sizes[id] ?? 1), 0);
        if (containerHeight <= 0 || totalWeight <= 0 || delta === 0) return {};
        const pxPerWeight = containerHeight / totalWeight;
        const aboveWeight = sizes[aboveId] ?? 1;
        const belowWeight = sizes[belowId] ?? 1;
        const pairWeight = aboveWeight + belowWeight;
        const minWeight = Math.min(pairWeight / 2, 48 / pxPerWeight);
        const nextAbove = Math.max(
          minWeight,
          Math.min(pairWeight - minWeight, aboveWeight + delta / pxPerWeight),
        );
        return {
          panel_stack_sizes: {
            ...sizes,
            [aboveId]: nextAbove,
            [belowId]: pairWeight - nextAbove,
          },
        };
      });
    },
    [updateUi],
  );

  const getPanelTitle = useCallback(
    (panelId: string) => {
      switch (panelId) {
        case "securityAuth":
          return t("securityAuth.title");
        case "aiAssistant":
          return t("ai.title");
        case "recording":
          return t("recording.panelTitle");
        default:
          return t(`panel.${panelId}`);
      }
    },
    [t],
  );

  const renderPanelContent = useCallback(
    (panelId: string | null) => (
      <AppPanelContent
        panelId={panelId}
        activePane={activePane}
        activeConnection={activeConnection}
        activeSessionId={activeSessionId}
        activeStatsSessionId={activeStatsSessionId}
        remoteStatsEnabled={activeRemoteStatsEnabled}
        remoteStats={remoteStats}
        gpuMonitorEnabled={uiConfig.show_gpu_monitor ?? false}
        gpuOverviewState={gpuOverviewState}
        npuMonitorEnabled={uiConfig.show_ascend_npu_monitor ?? false}
        npuOverviewState={npuOverviewState}
        recordingStatuses={recordingStatuses}
        aiIntent={aiIntent}
        transferHeight={uiConfig.transfer_height || 180}
        onTransferResize={handleTransferResize}
        onTemporarySshLink={handleOpenTemporarySshLink}
        onNewConnection={handleNewSession}
        onEditConnection={handleEditConnection}
        onConnectConnection={connectSavedConnection}
        onOpenSftp={openSftpWorkspace}
        onOpenS3={openS3Workspace}
        onOpenFtp={openFtpWorkspace}
        onOpenWebDav={openWebDavWorkspace}
        onSessionClick={handleSessionClick}
        onSessionReconnect={handleReconnectSessionById}
        onSessionDisconnect={handleDisconnectSessionById}
        canReconnect={canReconnectSessionById}
        onCommandSend={handleHistoryCommand}
        onToggleSessionRecording={handleToggleSessionRecording}
        onSaveSessionTranscript={handleSaveSessionTranscript}
      />
    ),
    [
      activeConnection,
      activeStatsSessionId,
      activePane,
      activeSessionId,
      aiIntent,
      activeRemoteStatsEnabled,
      canReconnectSessionById,
      remoteStats,
      gpuOverviewState,
      npuOverviewState,
      handleSaveSessionTranscript,
      handleDisconnectSessionById,
      handleEditConnection,
      handleHistoryCommand,
      handleNewSession,
      handleOpenTemporarySshLink,
      handleReconnectSessionById,
      handleSessionClick,
      handleToggleSessionRecording,
      handleTransferResize,
      connectSavedConnection,
      openSftpWorkspace,
      openS3Workspace,
      openFtpWorkspace,
      openWebDavWorkspace,
      recordingStatuses,
      uiConfig.show_ascend_npu_monitor,
      uiConfig.show_gpu_monitor,
      uiConfig.transfer_height,
    ],
  );

  const handleExternalMatchOpenChange = useCallback((open: boolean) => {
    if (open) return;
    setExternalMatchDialog((current) => {
      current?.resolve({ kind: "cancelled" });
      return null;
    });
  }, []);

  const handleExternalMatchConnection = useCallback((connection: SavedConnection) => {
    setExternalMatchDialog((current) => {
      current?.resolve({
        kind: "saved",
        connection,
        runtimeModeOverride: current.runtimeModeOverride,
      });
      return null;
    });
  }, []);

  const handleExternalMatchTemporary = useCallback((config: TemporaryLinkConfig) => {
    setExternalMatchDialog((current) => {
      current?.resolve({ kind: "temporary", config });
      return null;
    });
  }, []);

  const handlePostLoginConfirmOpenChange = useCallback((open: boolean) => {
    if (open) return;
    setPostLoginConfirm((current) => {
      current?.resolve(false);
      return null;
    });
  }, []);

  const handlePostLoginContinue = useCallback(() => {
    setPostLoginConfirm((current) => {
      current?.resolve(true);
      return null;
    });
  }, []);

  return (
    <TransferProvider>
      <AppLayout
        t={t}
        uiConfig={uiConfig}
        appearance={appSettings.appearance}
        keybindings={appSettings.keybindings}
        header={{
          onNewSession: () => handleNewSession(),
          onAbout: () => setShowAbout(true),
          onCheckForUpdates: () => setShowUpdateDialog(true),
          hasUpdate: updateInfo !== null,
          showUpdateDot: helpDotVisible,
          onHelpMenuOpen: () => setHelpDotVisible(false),
          leftActivityBarVisible: showLeftActivityBar,
          rightActivityBarVisible: showRightActivityBar,
          onToggleLeftActivityBar: () => handleToggleVisibility("left"),
          onToggleRightActivityBar: () => handleToggleVisibility("right"),
          tabBar: {
            tabs: terminalWindows ? flattenLeafTabs(terminalWindows, tabsById) : tabs,
            activeTabId,
            focusedTabId: activeTabId,
            unreadTabIds,
            disconnectedTabIds,
            onTabChange: handleSelectHeaderTab,
            onTabClose: handleCloseWorkspaceTab,
            onAddTab: handleAddHeaderTab,
            onOpenWorkbench: handleOpenWorkbench,
            onConnectConnection: handleConnectConnectionFromHeader,
            onSelectLocalShell: handleSelectLocalShell,
            onDuplicateSession: handleDuplicateSession,
            onMultiplexSshSession: handleMultiplexSshSession,
            onMultiplexSshSftpSession: handleMultiplexSshSftpSession,
            onDuplicateSessionWithCommand: handleDuplicateSessionWithCommand,
            onMultiplexSshSessionWithCommand: handleMultiplexSshSessionWithCommand,
            onReconnectSession: handleReconnectSession,
            onDisconnectSession: handleDisconnectSession,
            onSplitSession: handleSplitSession,
            onUnsplit: handleUnsplit,
            onCloseSession: handleCloseSession,
            onCloseAll: handleCloseAllTabs,
            onCloseInactive: handleCloseInactiveTabs,
            onCloseRight: handleCloseRightTabs,
            onSessionInfo: handleSessionInfo,
            onReorderTabs: handleReorderHeaderTabs,
          },
          activeTab,
          savedConnections,
          remoteStatsEnabled: activeRemoteStatsEnabled,
          remoteStats,
          gpuOverviewState,
          npuOverviewState,
          onSmartSplit: handleSmartSplit,
          onUnsplit: handleUnsplit,
          canUnsplit: terminalWindows?.kind === "split",
          onManageSyncGroups: () => setShowSyncGroupDialog(true),
          onBroadcastToAll: () => setBroadcastToAll((prev) => !prev),
          broadcastToAll,
          onOpenCommandPalette: handleOpenSessionSwitcher,
          onClearTerminal: () => window.dispatchEvent(new CustomEvent("nyaterm:clear-terminal")),
          onRefitTerminals: () =>
            window.dispatchEvent(new CustomEvent("nyaterm:refresh-terminals")),
          locked: isLocked,
          onRequestQuit: handleRequestQuit,
          onToggleActivityBarItemVisibility: handleToggleItemVisibility,
          onRequestActivityBarReset: () => setShowActivityBarResetConfirm(true),
          onPanelOpenModeChange: handlePanelOpenModeChange,
        }}
        leftActivityBar={{
          items: leftTopItems,
          bottomItems: leftBottomItems,
          hiddenItems: leftHiddenItems,
          activeId: panelOpenMode === "floating" ? null : uiConfig.active_left_panel,
          activeIds: leftActivityActiveIds,
          activeBottomIds: toggleActiveIds,
          onSelect: handleItemSelect,
          onReorder: (zoneKey, ids) => handleReorder("left", zoneKey, ids),
          onMoveItem: handleMoveItem,
          onHideItem: handleHideItem,
          onShowItem: handleShowItem,
          onRequestResetLayout: () => setShowActivityBarResetConfirm(true),
          panelOpenMode,
          onPanelOpenModeChange: handlePanelOpenModeChange,
          onToggleLabel: () => handleToggleLabel("left"),
          onHide: () => handleSetVisibility("left", false),
          onShow: () => handleSetVisibility("left", true),
          showLabels: showLabelsLeft,
          visible: showLeftActivityBar,

        }}
        rightActivityBar={{
          items: rightTopItems,
          bottomItems: rightBottomItems,
          hiddenItems: rightHiddenItems,
          activeId: panelOpenMode === "floating" ? null : uiConfig.active_right_panel,
          activeIds: rightActivityActiveIds,
          activeBottomIds: toggleActiveIds,
          onSelect: handleItemSelect,
          onReorder: (zoneKey, ids) => handleReorder("right", zoneKey, ids),
          onMoveItem: handleMoveItem,
          onHideItem: handleHideItem,
          onShowItem: handleShowItem,
          onRequestResetLayout: () => setShowActivityBarResetConfirm(true),
          panelOpenMode,
          onPanelOpenModeChange: handlePanelOpenModeChange,
          onToggleLabel: () => handleToggleLabel("right"),
          onHide: () => handleSetVisibility("right", false),
          onShow: () => handleSetVisibility("right", true),
          showLabels: showLabelsRight,
          visible: showRightActivityBar,

        }}
        onLeftResize={handleLeftResize}
        onRightResize={handleRightResize}
        panelContent={renderPanelContent}
        panelTitle={getPanelTitle}
        leftPanelIds={dockedLeftPanelIds}
        rightPanelIds={dockedRightPanelIds}
        floatingPanelIds={visibleFloatingPanels}
        onCloseFloatingPanel={closeFloatingPanel}
        leftOverlayPanelId={dockedLeftOverlayPanelId}
        rightOverlayPanelId={dockedRightOverlayPanelId}
        panelStackSizes={uiConfig.panel_stack_sizes ?? {}}
        onPanelStackResize={handlePanelStackResize}
        workspace={{
          layout: terminalWindows,
          tabsById,
          onSelectTab: handleSelectLeafTab,
          onMoveTabToLeaf: handleMoveTabToLeaf,
          onSplitTabToLeaf: handleSplitTabToLeaf,
          onActivatePane: handleActivatePane,
          onUpdatePaneSplitRatio: handleUpdatePaneSplitRatio,
          onUpdateWindowSplitRatio: handleUpdateWindowSplitRatio,
          onReconnectPane: handleReconnectPane,
          onReconnected: handleReconnected,
          onDisconnectedCloseRequested: handleCloseDisconnectedPane,
          onConnectionError: handleConnectionError,
          recordingStatuses,
          onToggleSessionRecording: handleToggleSessionRecordingById,
          onSaveSessionTranscript: handleSaveSessionTranscriptById,
        }}
        tabsCount={tabs.length}
        emptyWorkspace={{
          temporarySshShortcut,
          openChatShortcut,
          showCommandsShortcut,
          switchTerminalShortcut,
          onNewConnection: () => handleNewSession(),
          onNewLocalTerminal: handleNewLocalTerminal,
          onQuickOpenConnection: handleOpenConnectionQuickOpen,
          onTemporarySshLink: handleOpenTemporarySshLink,
          onOpenChat: handleOpenChat,
          onShowCommands: handleShowAllCommands,
          onSwitchTerminal: handleOpenSessionSwitcher,
          onConnectConnection: connectSavedConnection,
          onEditConnection: handleEditConnection,
        }}
        bottomPanel={{
          activePanel: activeBottomPanel,
          quickCmdHeight: uiConfig.quick_cmd_height || 180,
          serialSendHeight: uiConfig.serial_send_height || 180,
          clearAfterSend: uiConfig.serial_send_clear_after_send ?? false,
          activeSerialSessionId,
          activeNonSerialSessionId,
          activeNonSerialSessionIds,
          syncGroups,
          currentWindowLabel: getOwnerMainWindowLabel(),
          sessionTargets: sendCommandSessionTargets,
          sendCommandDraft,
          onSendCommandDraftConsumed: handleSendCommandDraftConsumed,
          onQuickCmdResize: handleQuickCmdResize,
          onSerialSendResize: handleSerialSendResize,
          onClearAfterSendChange: (enabled) => updateUi({ serial_send_clear_after_send: enabled }),
          onCommandSend: handleHistoryCommand,
          onSendToAllSessions: handleSendToAllSessions,
        }}
        dialogs={{
          aboutOpen: showAbout,
          onAboutOpenChange: setShowAbout,
          syncGroupOpen: showSyncGroupDialog,
          onSyncGroupOpenChange: setShowSyncGroupDialog,
          updateOpen: showUpdateDialog,
          onUpdateOpenChange: setShowUpdateDialog,
          onUpdateFound: setUpdateInfo,
          quitConfirmOpen: showQuitConfirm,
          onQuitConfirmOpenChange: setShowQuitConfirm,
          onQuitConfirm: handleQuitApplication,
          otpRequest: activeOtpRequest,
          onOtpDone: removeSecurityPrompt,
          sshAuthRequest: activeSshAuthRequest,
          onSshAuthDone: removeSecurityPrompt,
          sshAgentAuthRequest: activeSshAgentRequest,
          onSshAgentAuthDone: removeSecurityPrompt,
          dockerSudoPasswordRequest,
          onDockerSudoPasswordDone: (requestId) =>
            setDockerSudoPasswordRequest((current) =>
              current?.requestId === requestId ? null : current,
            ),
          hostKeyVerifyRequest: activeHostKeyRequest,
          onHostKeyVerifyDone: removeSecurityPrompt,
          rdpCertificateVerifyRequest: rdpCertificateRequests[0] ?? null,
          onRdpCertificateVerifyDone: (requestId) =>
            setRdpCertificateRequests((current) =>
              current.filter((item) => item.requestId !== requestId),
            ),
          ftpCertificateVerifyRequest: ftpCertificateRequests[0] ?? null,
          onFtpCertificateVerifyDone: (requestId) =>
            setFtpCertificateRequests((current) =>
              current.filter((item) => item.requestId !== requestId),
            ),
          modalChildWindowCount,
          locked: isLocked,
          hasMasterPassword: !!appSettings.security.master_password,
          onUnlock: () => setIsLocked(false),
          onRequestClose: handleRequestWindowClose,
        }}
      />
      <AppOverlayDialogs
        t={t}
        showSessionQuickSwitcher={showSessionQuickSwitcher}
        sessionSwitcherScope={sessionSwitcherScope}
        activeSessionId={activeSessionId}
        quickSwitcherSessions={quickSwitcherSessions}

        savedConnections={savedConnections}
        onCloseSessionQuickSwitcher={handleCloseSessionQuickSwitcher}
        onQuickSwitchSession={handleQuickSwitchSession}
        onQuickOpenConnection={handleQuickOpenConnection}
        onQuickSwitcherNewSshSession={handleQuickSwitcherNewSshSession}
        showTemporarySshLink={showTemporarySshLink}
        onTemporarySshLinkOpenChange={setShowTemporarySshLink}
        onTemporarySshConnect={handleTemporarySshConnect}
        externalMatchDialog={externalMatchDialog}
        savedGroups={savedGroups}
        onExternalMatchOpenChange={handleExternalMatchOpenChange}
        onExternalMatchConnection={handleExternalMatchConnection}
        onExternalMatchTemporary={handleExternalMatchTemporary}
        pendingFileDocumentClose={pendingFileDocumentClose}
        savingFileDocuments={savingFileDocuments}
        onPendingFileDocumentCloseOpenChange={handlePendingFileDocumentCloseOpenChange}
        onSaveFileDocumentsAndClose={handleSaveFileDocumentsAndClose}
        onDiscardFileDocumentsAndClose={handleDiscardFileDocumentsAndClose}
        postLoginConfirm={postLoginConfirm}
        onPostLoginConfirmOpenChange={handlePostLoginConfirmOpenChange}
        onPostLoginContinue={handlePostLoginContinue}
      />
      <LocalShellPickerDialog
        open={showLocalShellPicker}
        onClose={handleCloseLocalShellPicker}
        onSelect={handleSelectLocalShell}
      />
      <RemoteDesktopClientMissingDialog
        open={remoteDesktopMissing !== null}
        protocol={remoteDesktopMissing?.protocol ?? null}
        recommendations={remoteDesktopMissing?.recommendations ?? []}
        onClose={() => setRemoteDesktopMissing(null)}
      />
      <ActivityBarResetDialog
        t={t}
        open={showActivityBarResetConfirm}
        onOpenChange={setShowActivityBarResetConfirm}
        onConfirm={() => {
          setShowActivityBarResetConfirm(false);
          handleResetActivityBarLayout();

        }}
      />
    </TransferProvider>
  );
}

export default App;
