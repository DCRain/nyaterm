import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Terminal } from "@xterm/xterm";
import { toast } from "sonner";
import { emitAIErrorDetected } from "@/lib/aiEvents";
import {
  renderAiCommandEnd,
  renderAiCommandStart,
} from "@/lib/aiTerminalRenderer";
import { invoke } from "@/lib/invoke";
import { createTerminalInputState } from "@/lib/terminalInputTracker";
import type { AiCaptureEvent } from "@/types/global";
import type { Dec2026FrameGate } from "./dec2026FrameGate";
import { hasErrorKeyword } from "./terminalInputSelection";
import type {
  HibernationLogEvent,
  HibernationPhase,
  SessionCommandAcceptedEvent,
  TerminalOutputPayload,
} from "./xterminalInternalTypes";
import type { ZmodemEventPayload } from "./zmodemTerminalEvents";

interface MutableRef<T> {
  current: T;
}

interface ZmodemHandler {
  handle: (payload: ZmodemEventPayload) => void;
}

interface CreateXTerminalSessionEventsParams {
  sessionId: string;
  terminal: Terminal;
  frameGate: Dec2026FrameGate;
  sessionIdRef: MutableRef<string>;
  visibleRef: MutableRef<boolean>;
  lastErrorNoticeAtRef: MutableRef<number>;
  aiCapturingRef: MutableRef<boolean>;
  zmodemActiveRef: MutableRef<boolean>;
  inputStateRef: MutableRef<ReturnType<typeof createTerminalInputState>>;
  alternateScreenTrackerRef: MutableRef<{
    ingest: (data: string) => void;
  }>;
  hibernationPhaseRef: MutableRef<HibernationPhase>;
  detachedHibernateEpochRef: MutableRef<number | null>;
  onConnectionErrorRef: MutableRef<
    ((sessionId: string, error: string) => void) | undefined
  >;
  tRef: MutableRef<(key: string) => string>;
  isTerminalAlive: () => boolean;
  requestWake: (reason: string) => void;
  enterDisconnectedState: (options: {
    title: string;
    message?: string;
    titleColor: "31" | "36";
    showReconnectPrompt: boolean;
  }) => void;
  enterDisconnectedStateIfAttachSessionMissing: (error: unknown) => boolean;
  noteSkippedOutput: (count: number) => void;
  noteOutputActivity: () => void;
  updateCredentialPromptInputMode: (payload: string) => void;
  feedCredentialOutput: (payload: string) => void;
  maybeRecoverPerformanceMode: () => void;
  refreshOutputPressureMode: () => void;
  noteShellCommand: (command: string) => void;
  clearCredentialPromptInputMode: () => void;
  dismissSuggestions: () => void;
  writeTerminalTextAfterOutputQueue: (data: string) => Promise<void>;
  initialReplayPromise: Promise<void>;
  updateOutputDrainMode: () => void;
  logHibernation: (
    event: HibernationLogEvent,
    message: string,
    data?: Record<string, unknown>,
    error?: unknown,
  ) => void;
  zmodemHandler: ZmodemHandler;
  replayPendingWakeEvents: () => void;
}

export function createXTerminalSessionEvents({
  sessionId,
  terminal,
  frameGate,
  sessionIdRef,
  visibleRef,
  lastErrorNoticeAtRef,
  aiCapturingRef,
  zmodemActiveRef,
  inputStateRef,
  alternateScreenTrackerRef,
  hibernationPhaseRef,
  detachedHibernateEpochRef,
  onConnectionErrorRef,
  tRef,
  isTerminalAlive,
  requestWake,
  enterDisconnectedState,
  enterDisconnectedStateIfAttachSessionMissing,
  noteSkippedOutput,
  noteOutputActivity,
  updateCredentialPromptInputMode,
  feedCredentialOutput,
  maybeRecoverPerformanceMode,
  refreshOutputPressureMode,
  noteShellCommand,
  clearCredentialPromptInputMode,
  dismissSuggestions,
  writeTerminalTextAfterOutputQueue,
  initialReplayPromise,
  updateOutputDrainMode,
  logHibernation,
  zmodemHandler,
  replayPendingWakeEvents,
}: CreateXTerminalSessionEventsParams) {
  let disposed = false;
  const unlisteners: UnlistenFn[] = [];

  const addUnlistener = (unlisten: UnlistenFn) => {
    if (disposed) {
      unlisten();
      return false;
    }
    unlisteners.push(unlisten);
    return true;
  };

  const setup = async () => {
    const nextOutputUnlisten = await listen<TerminalOutputPayload>(
      `terminal-output-${sessionId}`,
      (event) => {
        if (!isTerminalAlive()) return;
        const payload = event.payload;
        if (!payload.data || payload.bytes <= 0) {
          noteSkippedOutput(payload.droppedBytes ?? 0);
          return;
        }
        noteOutputActivity();

        const recentPayload =
          payload.data.length > 4096
            ? payload.data.slice(-4096)
            : payload.data;
        alternateScreenTrackerRef.current.ingest(payload.data);
        updateCredentialPromptInputMode(recentPayload);
        feedCredentialOutput(recentPayload);
        if (visibleRef.current && hasErrorKeyword(recentPayload)) {
          const now = Date.now();
          if (now - lastErrorNoticeAtRef.current > 30_000) {
            lastErrorNoticeAtRef.current = now;
            emitAIErrorDetected({
              sessionId,
              output: recentPayload.slice(-4000),
            });
          }
        }

        noteSkippedOutput(payload.droppedBytes ?? 0);
        frameGate.enqueue({
          data: payload.data,
          bytes: payload.bytes,
        });

        if (!visibleRef.current) {
          maybeRecoverPerformanceMode();
          refreshOutputPressureMode();
          window.dispatchEvent(
            new CustomEvent("nyaterm:session-output", {
              detail: { sessionId },
            }),
          );
          return;
        }

        refreshOutputPressureMode();
      },
    );
    if (!addUnlistener(nextOutputUnlisten)) return;

    const nextCommandAcceptedUnlisten =
      await listen<SessionCommandAcceptedEvent>(
        "session-command-accepted",
        (event) => {
          if (!isTerminalAlive()) return;
          if (event.payload.sessionId !== sessionIdRef.current) return;
          noteShellCommand(event.payload.command);
        },
      );
    if (!addUnlistener(nextCommandAcceptedUnlisten)) return;

    const nextErrorUnlisten = await listen<string>(
      `session-error-${sessionId}`,
      (event) => {
        if (!isTerminalAlive()) return;
        requestWake("session_error");
        const message = String(
          event.payload || tRef.current("terminal.connectionFailed"),
        );
        enterDisconnectedState({
          title: tRef.current("terminal.connectionFailed"),
          message,
          titleColor: "31",
          showReconnectPrompt: false,
        });
        toast.error(message);
        onConnectionErrorRef.current?.(sessionIdRef.current, message);
      },
    );
    if (!addUnlistener(nextErrorUnlisten)) return;

    const nextClosedUnlisten = await listen<void>(
      `session-closed-${sessionId}`,
      () => {
        if (!isTerminalAlive()) return;
        requestWake("session_closed");
        enterDisconnectedState({
          title: tRef.current("terminal.sessionDisconnected"),
          titleColor: "31",
          showReconnectPrompt: true,
        });
      },
    );
    if (!addUnlistener(nextClosedUnlisten)) return;

    const nextFocusUnlisten = await listen<void>(
      `focus-terminal-${sessionId}`,
      () => {
        if (!isTerminalAlive()) return;
        requestWake("focus");
        terminal.focus();
      },
    );
    if (!addUnlistener(nextFocusUnlisten)) return;

    const nextCaptureUnlisten = await listen<AiCaptureEvent>(
      `ai-capture-${sessionId}`,
      (event) => {
        if (!isTerminalAlive()) return;
        const payload = event.payload;
        requestWake("ai");
        if (payload.type === "commandStart") {
          aiCapturingRef.current = true;
          inputStateRef.current = createTerminalInputState();
          clearCredentialPromptInputMode();
          dismissSuggestions();
          if (isTerminalAlive()) {
            void writeTerminalTextAfterOutputQueue(
              renderAiCommandStart(payload),
            );
          }
        } else if (payload.type === "commandEnd") {
          aiCapturingRef.current = false;
          if (isTerminalAlive()) {
            void writeTerminalTextAfterOutputQueue(renderAiCommandEnd(payload));
          }
        }
      },
    );
    if (!addUnlistener(nextCaptureUnlisten)) return;

    const nextZmodemUnlisten = await listen<ZmodemEventPayload>(
      `zmodem-event-${sessionId}`,
      (event) => {
        if (!isTerminalAlive()) return;
        requestWake("zmodem");
        if (
          event.payload.type === "detected" ||
          event.payload.type === "progress"
        ) {
          zmodemActiveRef.current = true;
        } else if (
          event.payload.type === "complete" ||
          event.payload.type === "failed"
        ) {
          zmodemActiveRef.current = false;
        }
        zmodemHandler.handle(event.payload);
      },
    );
    if (!addUnlistener(nextZmodemUnlisten)) return;

    replayPendingWakeEvents();

    try {
      await initialReplayPromise.catch(() => {});
      await invoke("attach_session", { sessionId });
      detachedHibernateEpochRef.current = null;
      if (
        hibernationPhaseRef.current === "waking" ||
        hibernationPhaseRef.current === "hibernated"
      ) {
        logHibernation("wake", "Attached backend output after terminal wake", {
          reason: "terminal_ready",
        });
      }
      hibernationPhaseRef.current = "idle";
      updateOutputDrainMode();
    } catch (error) {
      hibernationPhaseRef.current = "failed";
      logHibernation(
        "fail",
        "Failed to attach backend output after terminal wake",
        { reason: "terminal_ready" },
        error,
      );
      enterDisconnectedStateIfAttachSessionMissing(error);
    }
  };

  return {
    setup,
    dispose: () => {
      disposed = true;
      for (const unlisten of unlisteners.splice(0)) {
        unlisten();
      }
    },
  };
}
