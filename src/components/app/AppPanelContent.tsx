import { useRef } from "react";
import ResizeHandle from "@/components/layout/ResizeHandle";
import ActiveSessions from "@/components/panel/ActiveSessions";
import AscendNpuMonitor from "@/components/panel/AscendNpuMonitor";
import AIAssistantPanel from "@/components/panel/ai/AIAssistantPanel";
import CommandHistory from "@/components/panel/CommandHistory";
import DockerManager from "@/components/panel/DockerManager";
import FileExplorer from "@/components/panel/file-explorer";
import FileTransfer from "@/components/panel/file-explorer/FileTransfer";
import GpuMonitor from "@/components/panel/GpuMonitor";
import NetworkPanel from "@/components/panel/NetworkPanel";
import NotesPanel from "@/components/panel/notes/NotesPanel";
import ProcessManager from "@/components/panel/ProcessManager";
import RecordingPanel from "@/components/panel/RecordingPanel";
import ResourceMonitor from "@/components/panel/ResourceMonitor";
import SyncBackupHistoryPanel from "@/components/panel/SyncBackupHistoryPanel";
import SavedConnections from "@/components/panel/saved-connections";
import SecurityAuthPanel from "@/components/panel/security-auth";
import type { RemoteStatsState } from "@/hooks/useRemoteStats";
import type { AIOpenIntent } from "@/lib/aiEvents";
import type { NewSessionTarget } from "@/lib/windowManager";
import type { AssetMetadata, SavedConnection, SessionInfo, SessionPane } from "@/types/global";

interface AppPanelContentProps {
  panelId: string | null;
  activePane: SessionPane | null;
  activeConnection: SavedConnection | null;
  activeSessionId: string | null;
  activeSshSessionId: string | null;
  remoteStatsEnabled: boolean;
  remoteStats: RemoteStatsState;
  recordingSessions: Set<string>;
  aiIntent: AIOpenIntent | null;
  transferHeight: number;
  onTransferResize: (delta: number) => void;
  onTemporarySshLink: () => void;
  onNewConnection: (parentGroupId?: string) => void;
  onEditConnection: (
    connection: SavedConnection,
    autoConnect?: boolean,
    target?: NewSessionTarget,
  ) => void;
  onConnectConnection: (connection: SavedConnection) => Promise<void> | void;
  onSessionClick: (sessionId: string) => void;
  onSessionReconnect: (sessionId: string) => Promise<void> | void;
  onSessionDisconnect: (sessionId: string) => Promise<void> | void;
  canReconnect: (sessionId: string) => boolean;
  onCommandSend: (command: string, execute?: boolean) => void;
  onToggleSessionRecording: (session: SessionInfo) => Promise<void> | void;
  onSaveSessionTranscript: (session: SessionInfo) => Promise<void> | void;
  onAssetMonitoringPatch: (sessionId: string, patch: AssetMetadata) => void;
}

export default function AppPanelContent({
  panelId,
  activePane,
  activeConnection,
  activeSessionId,
  activeSshSessionId,
  remoteStatsEnabled,
  remoteStats,
  recordingSessions,
  aiIntent,
  transferHeight,
  onTransferResize,
  onTemporarySshLink,
  onNewConnection,
  onEditConnection,
  onConnectConnection,
  onSessionClick,
  onSessionReconnect,
  onSessionDisconnect,
  canReconnect,
  onCommandSend,
  onToggleSessionRecording,
  onSaveSessionTranscript,
  onAssetMonitoringPatch,
}: AppPanelContentProps) {
  const liveActivePane =
    activePane && !activePane.connecting && !activePane.connectError ? activePane : null;

  const aiEverMounted = useRef(false);
  if (panelId === "aiAssistant") aiEverMounted.current = true;

  const otherPanel = (() => {
    switch (panelId) {
      case "fileExplorer":
        return (
          <div className="h-full flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-hidden">
              <FileExplorer
                activeSessionId={activeSessionId}
                activeSessionType={liveActivePane ? liveActivePane.type : null}
                activeConnectionId={liveActivePane?.connectionId ?? null}
                activeSessionName={liveActivePane?.name ?? null}
              />
            </div>
            <ResizeHandle direction="vertical" onResize={onTransferResize} />
            <div style={{ height: transferHeight }} className="shrink-0 overflow-hidden">
              <FileTransfer activeSessionId={activeSessionId} />
            </div>
          </div>
        );
      case "network":
        return <NetworkPanel />;
      case "notes":
        return <NotesPanel />;
      case "securityAuth":
        return <SecurityAuthPanel activeSessionId={activeSessionId} />;
      case "syncBackupHistory":
        return <SyncBackupHistoryPanel />;
      case "savedConnections":
        return (
          <SavedConnections
            onTemporarySshLink={onTemporarySshLink}
            onNewConnection={onNewConnection}
            onEditConnection={onEditConnection}
            onConnectConnection={onConnectConnection}
          />
        );
      case "activeSessions":
        return (
          <ActiveSessions
            onSessionClick={onSessionClick}
            onSessionReconnect={onSessionReconnect}
            onSessionDisconnect={onSessionDisconnect}
            canReconnect={canReconnect}
          />
        );
      case "recording":
        return (
          <RecordingPanel
            activeSessionId={activeSessionId}
            recordingSessions={recordingSessions}
            onSessionClick={onSessionClick}
            onToggleRecording={onToggleSessionRecording}
            onSaveTranscript={onSaveSessionTranscript}
          />
        );
      case "commandHistory":
        return <CommandHistory activeSessionId={activeSessionId} onCommandSend={onCommandSend} />;
      case "resourceMonitor":
        return (
          <ResourceMonitor
            activeSessionId={activeSshSessionId}
            enabled={remoteStatsEnabled}
            remoteStats={remoteStats}
          />
        );
      case "gpuMonitor":
        return (
          <GpuMonitor activeSessionId={activeSshSessionId} onAssetPatch={onAssetMonitoringPatch} />
        );
      case "ascendNpuMonitor":
        return (
          <AscendNpuMonitor
            activeSessionId={activeSshSessionId}
            onAssetPatch={onAssetMonitoringPatch}
          />
        );
      case "processManager":
        return <ProcessManager activeSessionId={activeSshSessionId} />;
      case "dockerManager":
        return <DockerManager activeSessionId={activeSshSessionId} />;
      case "aiAssistant":
        return null;
      default:
        return null;
    }
  })();

  const isAiActive = panelId === "aiAssistant";

  return (
    <>
      {otherPanel}
      {aiEverMounted.current && (
        <div className={isAiActive ? "h-full" : "hidden"}>
          <AIAssistantPanel
            activePane={liveActivePane}
            activeConnection={activeConnection}
            intent={aiIntent}
          />
        </div>
      )}
    </>
  );
}
