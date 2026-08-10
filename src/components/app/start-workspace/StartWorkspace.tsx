import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useCallback } from "react";
import { useApp } from "@/context/AppContext";
import type { SavedConnection } from "@/types/global";
import AssetView from "./AssetView";
import type { StartWorkspaceMode } from "./types";
import WorkbenchView from "./WorkbenchView";

interface StartWorkspaceProps {
  t: TFunction;
  backgroundEnabled: boolean;
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
}

export default function StartWorkspace({
  t,
  backgroundEnabled,
  temporarySshShortcut,
  openChatShortcut,
  showCommandsShortcut,
  switchTerminalShortcut,
  onNewConnection,
  onNewLocalTerminal,
  onQuickOpenConnection,
  onTemporarySshLink,
  onOpenChat,
  onShowCommands,
  onSwitchTerminal,
  onConnectConnection,
  onEditConnection,
}: StartWorkspaceProps) {
  const { appSettings, updateUi } = useApp();
  const mode = normalizeStartWorkspaceMode(appSettings.ui.start_workspace_mode);
  const setMode = useCallback(
    (nextMode: StartWorkspaceMode) => {
      if (nextMode !== mode) {
        updateUi({ start_workspace_mode: nextMode });
      }
    },
    [mode, updateUi],
  );

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div className="pointer-events-none absolute left-0 right-0 top-3 z-30 flex justify-center">
        <div
          className="pointer-events-auto inline-flex rounded-lg border p-0.5 shadow-sm"
          style={{
            borderColor: "color-mix(in srgb, var(--df-border) 80%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--df-bg-panel) 88%, transparent)",
          }}
        >
          <ModeButton active={mode === "workbench"} onClick={() => setMode("workbench")}>
            {t("assets.workbench")}
          </ModeButton>
          <ModeButton active={mode === "assets"} onClick={() => setMode("assets")}>
            {t("assets.assets")}
          </ModeButton>
        </div>
      </div>

      {mode === "workbench" ? (
        <WorkbenchView
          t={t}
          backgroundEnabled={backgroundEnabled}
          temporarySshShortcut={temporarySshShortcut}
          openChatShortcut={openChatShortcut}
          showCommandsShortcut={showCommandsShortcut}
          switchTerminalShortcut={switchTerminalShortcut}
          onNewConnection={onNewConnection}
          onNewLocalTerminal={onNewLocalTerminal}
          onQuickOpenConnection={onQuickOpenConnection}
          onTemporarySshLink={onTemporarySshLink}
          onOpenChat={onOpenChat}
          onShowCommands={onShowCommands}
          onSwitchTerminal={onSwitchTerminal}
          onConnectConnection={onConnectConnection}
        />
      ) : (
        <div className="h-full min-h-0 pt-14">
          <AssetView
            t={t}
            onConnectConnection={onConnectConnection}
            onEditConnection={onEditConnection}
          />
        </div>
      )}
    </div>
  );
}

function normalizeStartWorkspaceMode(mode: string | undefined): StartWorkspaceMode {
  return mode === "assets" ? "assets" : "workbench";
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className="h-7 cursor-pointer rounded px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-[var(--df-primary)]"
      style={{
        color: active ? "var(--df-primary)" : "var(--df-text-muted)",
        backgroundColor: active
          ? "color-mix(in srgb, var(--df-primary) 12%, transparent)"
          : "transparent",
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
