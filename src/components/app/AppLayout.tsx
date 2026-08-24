import type { TFunction } from "i18next";
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import FloatingPanel from "@/components/app/FloatingPanel";
import { MdChevronLeft, MdChevronRight, MdTerminal } from "react-icons/md";
import PanelStack from "@/components/app/PanelStack";
import AboutDialog from "@/components/dialog/app/AboutDialog";
import LockScreen from "@/components/dialog/app/LockScreen";
import QuitConfirmDialog from "@/components/dialog/app/QuitConfirmDialog";
import UpdateDialog from "@/components/dialog/app/UpdateDialog";
import type { HostKeyVerifyRequest } from "@/components/dialog/connections/HostKeyVerifyDialog";
import { HostKeyVerifyDialog } from "@/components/dialog/connections/HostKeyVerifyDialog";
import type { OtpRequest } from "@/components/dialog/connections/OtpDialog";
import { OtpDialog } from "@/components/dialog/connections/OtpDialog";
import type { FtpCertificateVerifyRequest } from "@/components/dialog/connections/FtpCertificateVerifyDialog";
import { FtpCertificateVerifyDialog } from "@/components/dialog/connections/FtpCertificateVerifyDialog";
import type { RdpCertificateVerifyRequest } from "@/components/dialog/connections/RdpCertificateVerifyDialog";
import { RdpCertificateVerifyDialog } from "@/components/dialog/connections/RdpCertificateVerifyDialog";
import type { SshAgentAuthRequest } from "@/components/dialog/connections/SshAgentAuthDialog";
import { SshAgentAuthDialog } from "@/components/dialog/connections/SshAgentAuthDialog";
import type { SshAuthRequest } from "@/components/dialog/connections/SshAuthDialog";
import { SshAuthDialog } from "@/components/dialog/connections/SshAuthDialog";
import DockerSudoPasswordDialog, {
  type DockerSudoPasswordRequest,
} from "@/components/dialog/docker/DockerSudoPasswordDialog";
import { TransferDuplicateDialog } from "@/components/dialog/file-explorer/TransferDuplicateDialog";
import SyncGroupDialog from "@/components/dialog/terminal/SyncGroupDialog";
import ActivityBar from "@/components/layout/ActivityBar";
import Header from "@/components/layout/Header";
import ResizeHandle from "@/components/layout/ResizeHandle";
import QuickCommands from "@/components/panel/QuickCommands";
import SerialSendPanel from "@/components/panel/SendCommandPanel";
import { TOGGLE_REMOTE_DESKTOP_CHROME_EVENT } from "@/components/remote-desktop/FloatingSessionChrome";
import TabWindowsWorkspace from "@/components/terminal/TabWindowsWorkspace";
import { useTheme } from "@/context/ThemeContext";
import { resolveShortcutKeys } from "@/hooks/useShortcutMap";
import {
  buildBackgroundImageLayerStyle,
  buildSurfaceCssVariables,
  isWindowTransparencyEnabled,
  loadBackgroundImageDataUrl,
} from "@/lib/backgroundImage";
import type { SendCommandPanelDraft } from "@/lib/sendCommandPanelEvents";
import { matchesKeyEvent } from "@/lib/shortcutRegistry";
import {
  exitTerminalWindowFullscreen,
  isTerminalWindowFullscreen,
  TERMINAL_FULLSCREEN_CHANGED_EVENT,
  toggleTerminalWindowFullscreen,
} from "@/lib/terminalFullscreen";
import type { UpdateInfo } from "@/lib/updater";
import { cn } from "@/lib/utils";
import { bounceTopModalWindow } from "@/lib/windowManager";
import { useWindowTransparencyDom } from "@/lib/windowTransparencyDom";
import type {
  AppearanceSettings,
  SavedConnection,
  SessionType,
  SyncGroup,
  UiConfig,
} from "@/types/global";
import StartWorkspace from "./start-workspace/StartWorkspace";

type StartWorkspaceProps = ComponentProps<typeof StartWorkspace>;
export type WorkbenchPaneProps = Omit<StartWorkspaceProps, "t" | "backgroundEnabled">;

type HeaderProps = ComponentProps<typeof Header>;
type ActivityBarProps = ComponentProps<typeof ActivityBar>;
type WorkspaceProps = ComponentProps<typeof TabWindowsWorkspace>;
type ActivityBarSideProps = Omit<ActivityBarProps, "side" | "zone">;

interface AppLayoutProps {
  t: TFunction;
  uiConfig: UiConfig;
  appearance: AppearanceSettings;
  keybindings?: Record<string, string>;
  header: HeaderProps;
  leftActivityBar: ActivityBarSideProps;
  rightActivityBar: ActivityBarSideProps;
  onLeftResize: (delta: number) => void;
  onRightResize: (delta: number) => void;
  panelContent: (panelId: string | null) => ReactNode;
  panelTitle: (panelId: string) => string;
  /** Panels visible per side, ordered top-to-bottom (single id in single-open mode). */
  leftPanelIds: string[];
  rightPanelIds: string[];
  floatingPanelIds: {
    left: string | null;
    right: string | null;
  };
  onCloseFloatingPanel: (side: "left" | "right") => void;
  /** Exclusive panel (e.g. AI assistant) shown alone instead of the stack (multi-open mode). */
  leftOverlayPanelId: string | null;
  rightOverlayPanelId: string | null;
  panelStackSizes: Record<string, number>;
  onPanelStackResize: (
    side: "left" | "right",
    aboveId: string,
    belowId: string,
    delta: number,
    containerHeight: number,
  ) => void;
  workspace: WorkspaceProps;
  tabsCount: number;
  emptyWorkspace: {
    temporarySshShortcut: string;
    openChatShortcut: string;
    showCommandsShortcut: string;
    switchTerminalShortcut: string;
    onNewConnection: () => void;
    onNewLocalTerminal: () => void;
    onQuickOpenConnection: () => void;
    onTemporarySshLink: () => void;
    onOpenChat: () => void;
    onShowCommands: () => void;
    onSwitchTerminal: () => void;
    onConnectConnection: (connection: SavedConnection) => Promise<void> | void;
    onEditConnection: (connection: SavedConnection) => void;
  };
  bottomPanel: {
    activePanel: "quickCmdBar" | "serialSend" | null;
    quickCmdHeight: number;
    serialSendHeight: number;
    clearAfterSend: boolean;
    activeSerialSessionId: string | null;
    activeNonSerialSessionId: string | null;
    activeNonSerialSessionIds: string[];
    syncGroups: SyncGroup[];
    currentWindowLabel: string;
    sessionTargets: {
      id: string;
      name: string;
      tabName: string;
      type: SessionType;
      ownerWindowLabel?: string | null;
    }[];
    sendCommandDraft: SendCommandPanelDraft | null;
    onSendCommandDraftConsumed: () => void;
    onQuickCmdResize: (delta: number) => void;
    onSerialSendResize: (delta: number) => void;
    onClearAfterSendChange: (enabled: boolean) => void;
    onCommandSend: (command: string, execute?: boolean) => void;
    onSendToAllSessions: (command: string, execute?: boolean) => void;
  };
  dialogs: {
    aboutOpen: boolean;
    onAboutOpenChange: (open: boolean) => void;
    syncGroupOpen: boolean;
    onSyncGroupOpenChange: (open: boolean) => void;
    updateOpen: boolean;
    onUpdateOpenChange: (open: boolean) => void;
    onUpdateFound: (info: UpdateInfo) => void;
    quitConfirmOpen: boolean;
    onQuitConfirmOpenChange: (open: boolean) => void;
    onQuitConfirm: () => void;
    otpRequest: OtpRequest | null;
    onOtpDone: (requestId: string) => void;
    sshAuthRequest: SshAuthRequest | null;
    onSshAuthDone: (requestId: string) => void;
    sshAgentAuthRequest: SshAgentAuthRequest | null;
    onSshAgentAuthDone: (requestId: string) => void;
    dockerSudoPasswordRequest: DockerSudoPasswordRequest | null;
    onDockerSudoPasswordDone: (requestId: string) => void;
    hostKeyVerifyRequest: HostKeyVerifyRequest | null;
    onHostKeyVerifyDone: (requestId: string) => void;
    rdpCertificateVerifyRequest: RdpCertificateVerifyRequest | null;
    onRdpCertificateVerifyDone: (requestId: string) => void;
    ftpCertificateVerifyRequest: FtpCertificateVerifyRequest | null;
    onFtpCertificateVerifyDone: (requestId: string) => void;
    modalChildWindowCount: number;
    locked: boolean;
    hasMasterPassword: boolean;
    onUnlock: () => void;
    onRequestClose: () => void;
  };
}

export default function AppLayout({
  t,
  uiConfig,
  appearance,
  keybindings = {},
  header,
  leftActivityBar,
  rightActivityBar,
  onLeftResize,
  onRightResize,
  panelContent,
  panelTitle,
  leftPanelIds,
  rightPanelIds,
  floatingPanelIds,
  onCloseFloatingPanel,
  leftOverlayPanelId,
  rightOverlayPanelId,
  panelStackSizes,
  onPanelStackResize,
  workspace,
  tabsCount,
  emptyWorkspace,
  bottomPanel,
  dialogs,
}: AppLayoutProps) {
  const { theme } = useTheme();
  const backgroundImagePath = appearance.background_image_path?.trim() ?? "";
  const [backgroundDataUrl, setBackgroundDataUrl] = useState("");
  const [serialSendRunning, setSerialSendRunning] = useState(false);
  const [terminalFullscreen, setTerminalFullscreen] = useState(false);

  const toggleTerminalFullscreen = useCallback(async () => {
    try {
      await toggleTerminalWindowFullscreen();
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("nyaterm:refresh-terminals"));
      }, 50);
    } catch {
      // State is reset via TERMINAL_FULLSCREEN_CHANGED_EVENT.
    }
  }, []);

  useEffect(() => {
    const onFullscreenChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean }>).detail;
      setTerminalFullscreen(Boolean(detail?.active));
    };
    window.addEventListener(TERMINAL_FULLSCREEN_CHANGED_EVENT, onFullscreenChanged);
    return () => {
      window.removeEventListener(TERMINAL_FULLSCREEN_CHANGED_EVENT, onFullscreenChanged);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;

      const isF11 = event.code === "F11" || event.key === "F11" || event.key === "f11";
      const keys = resolveShortcutKeys("view.toggleFullscreen", keybindings);
      const matchesConfigured = Boolean(keys) && matchesKeyEvent(keys, event);
      // Always accept bare F11 even if keybindings override is empty/broken.
      const shouldToggle =
        matchesConfigured ||
        (isF11 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey);

      if (event.key === "Escape" && terminalFullscreen) {
        event.preventDefault();
        event.stopPropagation();
        void exitTerminalWindowFullscreen().then(() => {
          window.dispatchEvent(new CustomEvent("nyaterm:refresh-terminals"));
        });
        return;
      }

      if (!shouldToggle) return;
      event.preventDefault();
      event.stopPropagation();
      void toggleTerminalFullscreen();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, terminalFullscreen, toggleTerminalFullscreen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const keys = resolveShortcutKeys("view.toggleRemoteDesktopToolbar", keybindings);
      if (!keys || !matchesKeyEvent(keys, event)) return;
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent(TOGGLE_REMOTE_DESKTOP_CHROME_EVENT));
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings]);

  useEffect(() => {
    let cancelled = false;
    void isTerminalWindowFullscreen().then((isFullscreen) => {
      if (!cancelled) setTerminalFullscreen(isFullscreen);
    });
    return () => {
      cancelled = true;
      // Do not auto-exit on HMR/effect cleanup — that made F11 appear broken
      // during hot reload. Exit only when the page is actually unloading.
    };
  }, []);

  useEffect(() => {
    const onPageHide = () => {
      void exitTerminalWindowFullscreen().catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  useEffect(() => {
    let cancelled = false;

    setBackgroundDataUrl("");
    if (!backgroundImagePath) return;

    void loadBackgroundImageDataUrl(backgroundImagePath).then((dataUrl) => {
      if (!cancelled) setBackgroundDataUrl(dataUrl);
    });

    return () => {
      cancelled = true;
    };
  }, [backgroundImagePath]);

  const backgroundEnabled = Boolean(backgroundDataUrl);
  const effectiveAppearance = useMemo(
    () =>
      backgroundEnabled
        ? appearance
        : {
            ...appearance,
            background_image_path: null,
          },
    [appearance, backgroundEnabled],
  );
  const backgroundLayerStyle = useMemo(
    () => buildBackgroundImageLayerStyle(effectiveAppearance, backgroundDataUrl),
    [effectiveAppearance, backgroundDataUrl],
  );
  const windowTransparencyEnabled = isWindowTransparencyEnabled(effectiveAppearance);
  const windowTransparencyBlur =
    windowTransparencyEnabled && Boolean(effectiveAppearance.window_transparency_blur);
  useWindowTransparencyDom(theme.colors, effectiveAppearance);
  const shellStyle = useMemo(
    () => ({
      ...buildSurfaceCssVariables(theme.colors, effectiveAppearance),
      // When native window transparency is on, the shell background must be
      // transparent so the native backdrop is visible through the webview.
      backgroundColor: windowTransparencyEnabled ? "transparent" : theme.colors.bg,
      color: "var(--df-text)",
    }),
    [effectiveAppearance, theme.colors, windowTransparencyEnabled],
  );
  const hasLeftActivityItems =
    leftActivityBar.items.length > 0 ||
    (leftActivityBar.bottomItems?.length ?? 0) > 0 ||
    (leftActivityBar.hiddenItems?.length ?? 0) > 0;
  const hasRightActivityItems =
    rightActivityBar.items.length > 0 ||
    (rightActivityBar.bottomItems?.length ?? 0) > 0 ||
    (rightActivityBar.hiddenItems?.length ?? 0) > 0;
  const leftActivityBarVisible = Boolean(leftActivityBar.visible);
  const rightActivityBarVisible = Boolean(rightActivityBar.visible);
  const leftPanelOpen =
    hasLeftActivityItems && (leftPanelIds.length > 0 || Boolean(leftOverlayPanelId));
  const rightPanelOpen =
    hasRightActivityItems && (rightPanelIds.length > 0 || Boolean(rightOverlayPanelId));
  const serialSendVisible = bottomPanel.activePanel === "serialSend";
  const serialSendMounted = serialSendVisible || serialSendRunning;
  // When side chrome is gone, round the terminal so it doesn't cover window corners.
  const leftEdgeOccupied =
    !terminalFullscreen && ((hasLeftActivityItems && leftActivityBarVisible) || leftPanelOpen);
  const rightEdgeOccupied =
    !terminalFullscreen && ((hasRightActivityItems && rightActivityBarVisible) || rightPanelOpen);

  return (
    <div
      className="nyaterm-wallpaper-shell font-display relative h-full min-h-0 overflow-hidden"
      data-wallpaper-enabled={backgroundEnabled ? "true" : "false"}
      data-window-transparency={windowTransparencyEnabled ? "true" : "false"}
      data-window-transparency-blur={windowTransparencyBlur ? "true" : "false"}
      data-terminal-fullscreen={terminalFullscreen ? "true" : "false"}
      style={shellStyle}
    >
      {backgroundEnabled && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0"
          style={backgroundLayerStyle}
        />
      )}
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        {!terminalFullscreen && <Header {...header} />}

        <main className="flex-1 flex overflow-hidden relative">
          {!terminalFullscreen && hasLeftActivityItems && leftActivityBarVisible && (
            <ActivityBar
              {...leftActivityBar}
              side="left"
              zone={{ top: "left_top", bottom: "left_bottom" }}
              className="rounded-bl-[var(--nyaterm-window-radius)]"
            />
          )}

          {!terminalFullscreen && leftPanelOpen && (
            <>
              <div
                style={{
                  width: uiConfig.left_width,
                  backgroundColor: "var(--df-bg-panel)",
                }}
                className={cn(
                  "relative flex flex-col overflow-hidden",
                  !(hasLeftActivityItems && leftActivityBarVisible) &&
                    "rounded-bl-[var(--nyaterm-window-radius)]",
                )}
              >
                <div className="flex-1 min-h-0 overflow-hidden">
                  <PanelStack
                    panelIds={leftPanelIds}
                    overlayPanelId={leftOverlayPanelId}
                    sizes={panelStackSizes}
                    renderPanel={panelContent}
                    onResizePair={(aboveId, belowId, delta, containerHeight) =>
                      onPanelStackResize("left", aboveId, belowId, delta, containerHeight)
                    }
                  />
                </div>
              </div>
              <ResizeHandle direction="horizontal" onResize={onLeftResize} />
            </>
          )}

          <section
            className={cn(
              "relative flex min-w-0 flex-1 origin-top-left flex-col overflow-hidden",
              !leftEdgeOccupied && "rounded-bl-[var(--nyaterm-window-radius)]",
              !rightEdgeOccupied && "rounded-br-[var(--nyaterm-window-radius)]",
              terminalFullscreen && "rounded-none",
            )}
            style={{
              backgroundColor:
                backgroundEnabled && !terminalFullscreen ? "transparent" : "var(--df-bg-terminal)",
            }}
          >
            {!terminalFullscreen && hasLeftActivityItems && !leftActivityBarVisible && (
              <button
                type="button"
                className="absolute left-0 top-1/2 z-30 flex h-12 w-3 -translate-y-1/2 cursor-pointer items-center justify-center rounded-r-sm bg-transparent text-[var(--df-text-dimmed)] transition-colors hover:bg-[color-mix(in_srgb,var(--df-text-muted)_12%,transparent)] hover:text-[var(--df-primary)]"
                aria-label={t("activityBar.showLeft")}
                title={t("activityBar.showLeft")}
                onClick={() => leftActivityBar.onShow?.()}
              >
                <MdChevronRight className="text-sm" />
              </button>
            )}
            {!terminalFullscreen && hasRightActivityItems && !rightActivityBarVisible && (
              <button
                type="button"
                className="absolute right-0 top-1/2 z-30 flex h-12 w-3 -translate-y-1/2 cursor-pointer items-center justify-center rounded-l-sm bg-transparent text-[var(--df-text-dimmed)] transition-colors hover:bg-[color-mix(in_srgb,var(--df-text-muted)_12%,transparent)] hover:text-[var(--df-primary)]"
                aria-label={t("activityBar.showRight")}
                title={t("activityBar.showRight")}
                onClick={() => rightActivityBar.onShow?.()}
              >
                <MdChevronLeft className="text-sm" />
              </button>
            )}
            <div className="flex-1 relative overflow-hidden">
              {tabsCount === 0 ? (
                <StartWorkspace
                  t={t}
                  backgroundEnabled={backgroundEnabled}
                  temporarySshShortcut={emptyWorkspace.temporarySshShortcut}
                  openChatShortcut={emptyWorkspace.openChatShortcut}
                  showCommandsShortcut={emptyWorkspace.showCommandsShortcut}
                  switchTerminalShortcut={emptyWorkspace.switchTerminalShortcut}
                  onNewConnection={emptyWorkspace.onNewConnection}
                  onNewLocalTerminal={emptyWorkspace.onNewLocalTerminal}
                  onQuickOpenConnection={emptyWorkspace.onQuickOpenConnection}
                  onTemporarySshLink={emptyWorkspace.onTemporarySshLink}
                  onOpenChat={emptyWorkspace.onOpenChat}
                  onShowCommands={emptyWorkspace.onShowCommands}
                  onSwitchTerminal={emptyWorkspace.onSwitchTerminal}
                  onConnectConnection={emptyWorkspace.onConnectConnection}
                  onEditConnection={emptyWorkspace.onEditConnection}
                />
              ) : workspace.layout ? (
                <TabWindowsWorkspace
                  {...workspace}
                  workbench={{
                    t,
                    backgroundEnabled,
                    ...emptyWorkspace,
                  }}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-slate-500">
                  <div className="text-center space-y-3">
                    <MdTerminal className="text-4xl mx-auto" />
                    <p className="text-sm">{t("common.loading")}</p>
                  </div>
                </div>
              )}
              {floatingPanelIds.left && (
                <FloatingPanel
                  side="left"
                  panelId={floatingPanelIds.left}
                  width={uiConfig.left_width}
                  title={panelTitle(floatingPanelIds.left)}
                  onClose={() => onCloseFloatingPanel("left")}
                  onResize={onLeftResize}
                >
                  {panelContent(floatingPanelIds.left)}
                </FloatingPanel>
              )}
              {floatingPanelIds.right && (
                <FloatingPanel
                  side="right"
                  panelId={floatingPanelIds.right}
                  width={uiConfig.right_width}
                  title={panelTitle(floatingPanelIds.right)}
                  onClose={() => onCloseFloatingPanel("right")}
                  onResize={onRightResize}
                >
                  {panelContent(floatingPanelIds.right)}
                </FloatingPanel>
              )}
            </div>

            {bottomPanel.activePanel === "quickCmdBar" && (
              <>
                <ResizeHandle direction="vertical" onResize={bottomPanel.onQuickCmdResize} />
                <div
                  style={{
                    height: bottomPanel.quickCmdHeight,
                    backgroundColor: "var(--df-bg-panel)",
                  }}
                  className="shrink-0 overflow-hidden"
                >
                  <QuickCommands
                    onSend={bottomPanel.onCommandSend}
                    onSendToAll={bottomPanel.onSendToAllSessions}
                  />
                </div>
              </>
            )}

            {serialSendVisible && (
              <ResizeHandle direction="vertical" onResize={bottomPanel.onSerialSendResize} />
            )}

            {serialSendMounted && (
              <div
                style={{
                  ...(serialSendVisible
                    ? {
                        height: bottomPanel.serialSendHeight,
                        backgroundColor: "var(--df-bg-panel)",
                      }
                    : {}),
                }}
                className={serialSendVisible ? "shrink-0 overflow-hidden" : "hidden"}
              >
                <SerialSendPanel
                  serialSessionId={bottomPanel.activeSerialSessionId}
                  currentShellSessionId={bottomPanel.activeNonSerialSessionId}
                  shellSessionIds={bottomPanel.activeNonSerialSessionIds}
                  syncGroups={bottomPanel.syncGroups}
                  currentWindowLabel={bottomPanel.currentWindowLabel}
                  sessionTargets={bottomPanel.sessionTargets}
                  clearAfterSend={bottomPanel.clearAfterSend}
                  draft={bottomPanel.sendCommandDraft}
                  onDraftConsumed={bottomPanel.onSendCommandDraftConsumed}
                  onSendingChange={setSerialSendRunning}
                  onClearAfterSendChange={bottomPanel.onClearAfterSendChange}
                />
              </div>
            )}
          </section>

          {!terminalFullscreen && hasRightActivityItems && (
            <>
              {rightPanelOpen && <ResizeHandle direction="horizontal" onResize={onRightResize} />}
              <aside
                style={{
                  width: rightPanelOpen ? uiConfig.right_width : 0,
                  backgroundColor: "var(--df-bg-panel)",
                  borderColor: "var(--df-border)",
                }}
                className={cn(
                  "relative flex flex-col overflow-hidden",
                  rightPanelOpen ? "border-l" : "hidden",
                  !(hasRightActivityItems && rightActivityBarVisible) &&
                    "rounded-br-[var(--nyaterm-window-radius)]",
                )}
              >
                <div className="flex-1 min-h-0 overflow-hidden">
                  <PanelStack
                    panelIds={rightPanelIds}
                    overlayPanelId={rightOverlayPanelId}
                    sizes={panelStackSizes}
                    renderPanel={panelContent}
                    onResizePair={(aboveId, belowId, delta, containerHeight) =>
                      onPanelStackResize("right", aboveId, belowId, delta, containerHeight)
                    }
                  />
                </div>
              </aside>
            </>
          )}

          {!terminalFullscreen && hasRightActivityItems && rightActivityBarVisible && (
            <ActivityBar
              {...rightActivityBar}
              side="right"
              zone={{ top: "right_top", bottom: "right_bottom" }}
              className="rounded-br-[var(--nyaterm-window-radius)]"
            />
          )}
        </main>

        <AboutDialog open={dialogs.aboutOpen} onClose={() => dialogs.onAboutOpenChange(false)} />

        <SyncGroupDialog
          open={dialogs.syncGroupOpen}
          onClose={() => dialogs.onSyncGroupOpenChange(false)}
        />

        <UpdateDialog
          open={dialogs.updateOpen}
          onClose={() => dialogs.onUpdateOpenChange(false)}
          onUpdateFound={dialogs.onUpdateFound}
        />

        <QuitConfirmDialog
          open={dialogs.quitConfirmOpen}
          onOpenChange={dialogs.onQuitConfirmOpenChange}
          onConfirm={dialogs.onQuitConfirm}
        />

        <OtpDialog request={dialogs.otpRequest} onDone={dialogs.onOtpDone} />
        <SshAuthDialog request={dialogs.sshAuthRequest} onDone={dialogs.onSshAuthDone} />
        <SshAgentAuthDialog
          request={dialogs.sshAgentAuthRequest}
          onDone={dialogs.onSshAgentAuthDone}
        />
        <DockerSudoPasswordDialog
          request={dialogs.dockerSudoPasswordRequest}
          onDone={dialogs.onDockerSudoPasswordDone}
        />
        <HostKeyVerifyDialog
          request={dialogs.hostKeyVerifyRequest}
          onDone={dialogs.onHostKeyVerifyDone}
        />
        <RdpCertificateVerifyDialog
          request={dialogs.rdpCertificateVerifyRequest}
          onDone={dialogs.onRdpCertificateVerifyDone}
        />
        <FtpCertificateVerifyDialog
          request={dialogs.ftpCertificateVerifyRequest}
          onDone={dialogs.onFtpCertificateVerifyDone}
        />
        <TransferDuplicateDialog />

        {dialogs.modalChildWindowCount > 0 && (
          <div
            className="fixed inset-0 z-[9998]"
            onMouseDown={() => {
              void bounceTopModalWindow();
            }}
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.3)",
              backdropFilter: "blur(4px)",
              WebkitBackdropFilter: "blur(4px)",
            }}
          />
        )}

        {dialogs.locked && (
          <LockScreen
            hasPassword={dialogs.hasMasterPassword}
            onUnlock={dialogs.onUnlock}
            onRequestClose={dialogs.onRequestClose}
          />
        )}
      </div>
    </div>
  );
}
