import type { RecordingMode, RecordingStatus, SessionType } from "@/types/global";

export interface SyncOverlayState {
  peerCount: number;
  isPaused: boolean;
  groupColor?: string;
  groupName?: string;
  onPauseResume: () => void;
  onLeaveGroup: () => void;
  onCloseGroup: () => void;
}

export interface XTerminalProps {
  sessionId: string;
  sessionName?: string;
  active: boolean;
  visible?: boolean;
  sessionType: SessionType;
  connectionId?: string;
  temporaryConfig?: {
    protocol: "ssh" | "telnet" | "serial";
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    portName?: string;
    baudRate?: number;
  };
  onReconnected?: (oldSessionId: string, newSessionId: string) => void;
  onDisconnectedCloseRequested?: () => void;
  onConnectionError?: (sessionId: string, error: string) => void;
  syncPeerSessionIds?: string[];
  syncOverlay?: SyncOverlayState;
  recordingStatus?: RecordingStatus;
  onToggleRecording?: (sessionId: string, mode?: RecordingMode) => Promise<void> | void;
  onSaveTranscript?: (sessionId: string, sessionName?: string) => Promise<void> | void;
}

export interface MultiLinePasteDialogProps {
  open: boolean;
  text: string | null;
  onClose: () => void;
  onDirectPaste: (text: string) => void;
  onSendLineByLine: (text: string) => void;
}

export type PerformanceMode = "normal" | "strained" | "overloaded";
