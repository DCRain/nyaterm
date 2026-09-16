import type { FloatingPanelsState } from "@/lib/appWorkspace";
import type { SessionInfo, SessionPane, WorkspaceSessionType } from "@/types/global";

/**
 * Coarse session class used to gate activity-bar tools.
 * `sshShell` / `localShell` / `telnetShell` share most shell tools but differ
 * for file explorer and remote monitors.
 */
export type ActivitySessionContext =
  | "sshShell"
  | "localShell"
  | "telnetShell"
  | "serial"
  | "storage"
  | "remoteDesktop"
  | "none";

/** Activity items that always remain available regardless of session type. */
export const GLOBAL_ACTIVITY_ITEM_IDS = new Set([
  "savedConnections",
  "activeSessions",
  "notes",
  "network",
  "securityAuth",
  "syncBackupHistory",
  "settings",
  "lock",
]);

const REMOTE_MONITOR_IDS = new Set([
  "resourceMonitor",
  "gpuMonitor",
  "ascendNpuMonitor",
  "processManager",
  "dockerManager",
]);

const SHELL_TOOL_IDS = new Set([
  "aiAssistant",
  "commandHistory",
  "quickCmdBar",
  "serialSend",
  "recording",
]);

export function isSftpOnlyPane(
  pane: SessionPane | null | undefined,
  sessionsById: Map<string, SessionInfo> | null | undefined,
): boolean {
  return (
    pane?.paneKind === "terminal" &&
    pane.type === "SSH" &&
    (pane.sshRuntimeMode === "sftp" ||
      sessionsById?.get(pane.sessionId)?.ssh_runtime_mode === "sftp")
  );
}

function shellContextForType(type: WorkspaceSessionType): ActivitySessionContext {
  switch (type) {
    case "SSH":
      return "sshShell";
    case "Local":
      return "localShell";
    case "Telnet":
      return "telnetShell";
    default:
      return "none";
  }
}

/**
 * Resolve the activity-bar capability context from the active workspace pane.
 * Connecting / errored / note / file-document panes fall into `none`.
 */
export function resolveActivitySessionContext(
  pane: SessionPane | null | undefined,
  sessionsById?: Map<string, SessionInfo> | null,
): ActivitySessionContext {
  if (!pane || pane.connecting || pane.connectError) return "none";

  if (pane.paneKind === "file") return "none";
  if (pane.paneKind === "remote-desktop") return "remoteDesktop";

  if (pane.paneKind === "terminal") {
    const view = pane.view;
    if (view === "note" || view === "externalMarkdown" || view === "workbench" || view === "settings") {
      return "none";
    }
    if (view === "s3" || view === "ftp" || view === "webdav" || view === "sftp") {
      return "storage";
    }
    if (isSftpOnlyPane(pane, sessionsById)) {
      return "storage";
    }

    switch (pane.type) {
      case "SSH":
      case "Local":
      case "Telnet":
        return shellContextForType(pane.type);
      case "Serial":
        return "serial";
      case "S3":
      case "FTP":
      case "WebDAV":
        return "storage";
      default:
        return "none";
    }
  }

  return "none";
}

function isShellLike(context: ActivitySessionContext): boolean {
  return (
    context === "sshShell" ||
    context === "localShell" ||
    context === "telnetShell" ||
    context === "serial"
  );
}

/**
 * Whether an activity-bar item applies to the current session context.
 * Feature flags (`show_*`) are layered separately by callers.
 */
export function isActivityItemApplicable(
  id: string,
  context: ActivitySessionContext,
): boolean {
  if (GLOBAL_ACTIVITY_ITEM_IDS.has(id)) return true;

  if (id === "fileExplorer") {
    // Storage workspaces (S3/FTP/WebDAV/SFTP) open as dedicated panes; the
    // activity-bar file explorer is only for SSH/Local terminal sessions.
    return context === "sshShell" || context === "localShell";
  }

  if (REMOTE_MONITOR_IDS.has(id)) {
    return context === "sshShell";
  }

  if (SHELL_TOOL_IDS.has(id)) {
    return isShellLike(context);
  }

  // Unknown / future items: keep visible so we don't accidentally hide them.
  return true;
}

export function filterApplicableActivityIds(
  ids: string[],
  context: ActivitySessionContext,
): string[] {
  return ids.filter((id) => isActivityItemApplicable(id, context));
}

export function pruneOpenPanelState(
  openIds: string[] | null | undefined,
  activeId: string | null | undefined,
  context: ActivitySessionContext,
): { openIds: string[]; activeId: string | null } {
  const nextOpen = (openIds ?? []).filter((id) => isActivityItemApplicable(id, context));
  const nextActive =
    activeId && isActivityItemApplicable(activeId, context) ? activeId : null;
  return { openIds: nextOpen, activeId: nextActive };
}

export function clearInapplicableFloatingPanels(
  state: FloatingPanelsState,
  context: ActivitySessionContext,
): FloatingPanelsState {
  const left =
    state.left && isActivityItemApplicable(state.left, context) ? state.left : null;
  const right =
    state.right && isActivityItemApplicable(state.right, context) ? state.right : null;
  return left === state.left && right === state.right ? state : { left, right };
}

export function stickyBottomPanelPatch(
  showQuickCmd: boolean,
  showSerialSend: boolean,
  context: ActivitySessionContext,
): { show_quick_cmd_bar?: false; show_serial_send_panel?: false } | null {
  const patch: { show_quick_cmd_bar?: false; show_serial_send_panel?: false } = {};
  if (showQuickCmd && !isActivityItemApplicable("quickCmdBar", context)) {
    patch.show_quick_cmd_bar = false;
  }
  if (showSerialSend && !isActivityItemApplicable("serialSend", context)) {
    patch.show_serial_send_panel = false;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
