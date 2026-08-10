import type { TFunction } from "i18next";
import { type ComponentProps, type ReactNode, useEffect, useMemo, useState } from "react";
import { MdTerminal } from "react-icons/md";
import PanelStack from "@/components/app/PanelStack";
import AboutDialog from "@/components/dialog/app/AboutDialog";
import LockScreen from "@/components/dialog/app/LockScreen";
import QuitConfirmDialog from "@/components/dialog/app/QuitConfirmDialog";
import UpdateDialog from "@/components/dialog/app/UpdateDialog";
import type { HostKeyVerifyRequest } from "@/components/dialog/connections/HostKeyVerifyDialog";
import { HostKeyVerifyDialog } from "@/components/dialog/connections/HostKeyVerifyDialog";
import type { OtpRequest } from "@/components/dialog/connections/OtpDialog";
import { OtpDialog } from "@/components/dialog/connections/OtpDialog";
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
import TabWindowsWorkspace from "@/components/terminal/TabWindowsWorkspace";
import { useTheme } from "@/context/ThemeContext";
import {
  buildBackgroundImageLayerStyle,
  buildSurfaceCssVariables,
  isWindowTransparencyEnabled,
  loadBackgroundImageDataUrl,
} from "@/lib/backgroundImage";
import type { SendCommandPanelDraft } from "@/lib/sendCommandPanelEvents";
import type { UpdateInfo } from "@/lib/updater";
import { bounceTopModalWindow } from "@/lib/windowManager";
import type {
  AppearanceSettings,
  SavedConnection,
  SessionType,
  SyncGroup,
  UiConfig,
} from "@/types/global";
import StartWorkspace from "./start-workspace/StartWorkspace";

type HeaderProps = ComponentProps<typeof Header>;
type ActivityBarProps = ComponentProps<typeof ActivityBar>;
type WorkspaceProps = ComponentProps<typeof TabWindowsWorkspace>;
type ActivityBarSideProps = Omit<ActivityBarProps, "side" | "zone">;

interface AppLayoutProps {
  t: TFunction;
  uiConfig: UiConfig;
  appearance: AppearanceSettings;
  header: HeaderProps;
  leftActivityBar: ActivityBarSideProps;
  rightActivityBar: ActivityBarSideProps;
  onLeftResize: (delta: number) => void;
  onRightResize: (delta: number) => void;
  panelContent: (panelId: string | null) => ReactNode;
  /** Panels visible per side, ordered top-to-bottom (single id in single-open mode). */
  leftPanelIds: string[];
  rightPanelIds: string[];
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
    activeSerialSessionId: string | null;
    activeNonSerialSessionId: string | null;
    activeNonSerialSessionIds: string[];
    syncGroups: SyncGroup[];
    sessionTargets: { id: string; name: string; tabName: string; type: SessionType }[];
    sendCommandDraft: SendCommandPanelDraft | null;
    onSendCommandDraftConsumed: () => void;
    onQuickCmdResize: (delta: number) => void;
    onSerialSendResize: (delta: number) => void;
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
    dockerSudoPasswordRequest: DockerSudoPasswordRequest | null;
    onDockerSudoPasswordDone: (requestId: string) => void;
    hostKeyVerifyRequest: HostKeyVerifyRequest | null;
    onHostKeyVerifyDone: () => void;
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
  header,
  leftActivityBar,
  rightActivityBar,
  onLeftResize,
  onRightResize,
  panelContent,
  leftPanelIds,
  rightPanelIds,
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
    leftActivityBar.items.length > 0 || (leftActivityBar.bottomItems?.length ?? 0) > 0;
  const hasRightActivityItems =
    rightActivityBar.items.length > 0 || (rightActivityBar.bottomItems?.length ?? 0) > 0;
  const leftActivityBarVisible = Boolean(leftActivityBar.visible);
  const rightActivityBarVisible = Boolean(rightActivityBar.visible);
  const leftPanelOpen =
    hasLeftActivityItems && (leftPanelIds.length > 0 || Boolean(leftOverlayPanelId));
  const rightPanelOpen =
    hasRightActivityItems && (rightPanelIds.length > 0 || Boolean(rightOverlayPanelId));

  useEffect(() => {
    const roots = [document.documentElement, document.body];
    for (const root of roots) {
      if (windowTransparencyEnabled) {
        root.dataset.windowTransparency = "true";
      } else {
        delete root.dataset.windowTransparency;
      }
    }

    return () => {
      for (const root of roots) {
        delete root.dataset.windowTransparency;
      }
    };
  }, [windowTransparencyEnabled]);

  return (
    <div
      className="nyaterm-wallpaper-shell font-display relative h-full min-h-0 overflow-hidden"
      data-wallpaper-enabled={backgroundEnabled ? "true" : "false"}
      data-window-transparency={windowTransparencyEnabled ? "true" : "false"}
      data-window-transparency-blur={
        windowTransparencyEnabled && effectiveAppearance.window_transparency_blur ? "true" : "false"
      }
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
        <Header {...header} />

        <main className="flex-1 flex overflow-hidden relative">
          {hasLeftActivityItems && leftActivityBarVisible && (
            <ActivityBar
              {...leftActivityBar}
              side="left"
              zone={{ top: "left_top", bottom: "left_bottom" }}
            />
          )}

          {leftPanelOpen && (
            <>
              <div
                style={{
                  width: uiConfig.left_width,
                  backgroundColor: "var(--df-bg-panel)",
                }}
                className="relative flex flex-col"
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
            className="flex-1 flex flex-col relative min-w-0 origin-top-left"
            style={{
              backgroundColor: backgroundEnabled ? "transparent" : "var(--df-bg-terminal)",
            }}
          >
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
                <TabWindowsWorkspace {...workspace} />
              ) : (
                <div className="flex items-center justify-center h-full text-slate-500">
                  <div className="text-center space-y-3">
                    <MdTerminal className="text-4xl mx-auto" />
                    <p className="text-sm">{t("common.loading")}</p>
                  </div>
                </div>
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

            {bottomPanel.activePanel === "serialSend" && (
              <>
                <ResizeHandle direction="vertical" onResize={bottomPanel.onSerialSendResize} />
                <div
                  style={{
                    height: bottomPanel.serialSendHeight,
                    backgroundColor: "var(--df-bg-panel)",
                  }}
                  className="shrink-0 overflow-hidden"
                >
                  <SerialSendPanel
                    serialSessionId={bottomPanel.activeSerialSessionId}
                    currentShellSessionId={bottomPanel.activeNonSerialSessionId}
                    shellSessionIds={bottomPanel.activeNonSerialSessionIds}
                    syncGroups={bottomPanel.syncGroups}
                    sessionTargets={bottomPanel.sessionTargets}
                    draft={bottomPanel.sendCommandDraft}
                    onDraftConsumed={bottomPanel.onSendCommandDraftConsumed}
                  />
                </div>
              </>
            )}
          </section>

          {hasRightActivityItems && (
            <>
              {rightPanelOpen && <ResizeHandle direction="horizontal" onResize={onRightResize} />}
              <aside
                style={{
                  width: rightPanelOpen ? uiConfig.right_width : 0,
                  backgroundColor: "var(--df-bg-panel)",
                  borderColor: "var(--df-border)",
                }}
                className={`relative flex flex-col overflow-hidden ${
                  rightPanelOpen ? "border-l" : "hidden"
                }`}
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

          {hasRightActivityItems && rightActivityBarVisible && (
            <ActivityBar
              {...rightActivityBar}
              side="right"
              zone={{ top: "right_top", bottom: "right_bottom" }}
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
        <DockerSudoPasswordDialog
          request={dialogs.dockerSudoPasswordRequest}
          onDone={dialogs.onDockerSudoPasswordDone}
        />
        <HostKeyVerifyDialog
          request={dialogs.hostKeyVerifyRequest}
          onDone={dialogs.onHostKeyVerifyDone}
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
