import { describe, expect, it } from "vitest";
import type { SessionInfo, SessionPane } from "@/types/global";
import {
  clearInapplicableFloatingPanels,
  isActivityItemApplicable,
  isSftpOnlyPane,
  pruneOpenPanelState,
  resolveActivitySessionContext,
  stickyBottomPanelPatch,
} from "./activityBarSessionCapabilities";

const basePane = {
  id: "pane-1",
  kind: "leaf",
  paneKind: "terminal",
  sessionId: "session-1",
  name: "Session",
  connecting: false,
} as const;

function pane(overrides: Partial<SessionPane>): SessionPane {
  return {
    ...basePane,
    type: "SSH",
    ...overrides,
  } as SessionPane;
}

describe("resolveActivitySessionContext", () => {
  it("maps standard SSH / Local / Telnet / Serial / storage / RDP", () => {
    expect(resolveActivitySessionContext(pane({ type: "SSH" }))).toBe("sshShell");
    expect(resolveActivitySessionContext(pane({ type: "Local" }))).toBe("localShell");
    expect(resolveActivitySessionContext(pane({ type: "Telnet" }))).toBe("telnetShell");
    expect(resolveActivitySessionContext(pane({ type: "Serial" }))).toBe("serial");
    expect(resolveActivitySessionContext(pane({ type: "FTP" }))).toBe("storage");
    expect(resolveActivitySessionContext(pane({ type: "S3" }))).toBe("storage");
    expect(resolveActivitySessionContext(pane({ type: "WebDAV" }))).toBe("storage");
    expect(
      resolveActivitySessionContext(
        pane({ paneKind: "remote-desktop", type: "RDP" } as Partial<SessionPane>),
      ),
    ).toBe("remoteDesktop");
  });

  it("treats sftp-only SSH and storage views as storage", () => {
    expect(resolveActivitySessionContext(pane({ sshRuntimeMode: "sftp" }))).toBe("storage");
    expect(resolveActivitySessionContext(pane({ view: "ftp" }))).toBe("storage");
    expect(resolveActivitySessionContext(pane({ view: "sftp" }))).toBe("storage");
    const sessions = new Map<string, SessionInfo>([
      [
        "session-1",
        { id: "session-1", ssh_runtime_mode: "sftp" } as SessionInfo,
      ],
    ]);
    expect(resolveActivitySessionContext(pane({ type: "SSH" }), sessions)).toBe("storage");
  });

  it("returns none for missing, connecting, note, and file panes", () => {
    expect(resolveActivitySessionContext(null)).toBe("none");
    expect(resolveActivitySessionContext(pane({ connecting: true }))).toBe("none");
    expect(resolveActivitySessionContext(pane({ connectError: "fail" }))).toBe("none");
    expect(resolveActivitySessionContext(pane({ view: "note" }))).toBe("none");
    expect(
      resolveActivitySessionContext(pane({ paneKind: "file" } as Partial<SessionPane>)),
    ).toBe("none");
  });
});

describe("isActivityItemApplicable", () => {
  it("keeps global items everywhere", () => {
    for (const ctx of [
      "none",
      "storage",
      "remoteDesktop",
      "serial",
      "sshShell",
    ] as const) {
      expect(isActivityItemApplicable("savedConnections", ctx)).toBe(true);
      expect(isActivityItemApplicable("settings", ctx)).toBe(true);
      expect(isActivityItemApplicable("lock", ctx)).toBe(true);
    }
  });

  it("gates session tools by context", () => {
    expect(isActivityItemApplicable("fileExplorer", "storage")).toBe(false);
    expect(isActivityItemApplicable("fileExplorer", "sshShell")).toBe(true);
    expect(isActivityItemApplicable("fileExplorer", "localShell")).toBe(true);
    expect(isActivityItemApplicable("fileExplorer", "telnetShell")).toBe(false);
    expect(isActivityItemApplicable("fileExplorer", "remoteDesktop")).toBe(false);

    expect(isActivityItemApplicable("resourceMonitor", "sshShell")).toBe(true);
    expect(isActivityItemApplicable("resourceMonitor", "localShell")).toBe(false);
    expect(isActivityItemApplicable("dockerManager", "storage")).toBe(false);

    expect(isActivityItemApplicable("commandHistory", "sshShell")).toBe(true);
    expect(isActivityItemApplicable("commandHistory", "serial")).toBe(true);
    expect(isActivityItemApplicable("commandHistory", "storage")).toBe(false);
    expect(isActivityItemApplicable("aiAssistant", "storage")).toBe(false);
    expect(isActivityItemApplicable("quickCmdBar", "remoteDesktop")).toBe(false);
    expect(isActivityItemApplicable("recording", "none")).toBe(false);
  });
});

describe("prune helpers", () => {
  it("prunes open/active panels that no longer apply", () => {
    expect(
      pruneOpenPanelState(
        ["resourceMonitor", "savedConnections"],
        "resourceMonitor",
        "storage",
      ),
    ).toEqual({ openIds: ["savedConnections"], activeId: null });
  });

  it("clears inapplicable floating panels", () => {
    expect(
      clearInapplicableFloatingPanels(
        { left: "fileExplorer", right: "commandHistory" },
        "storage",
      ),
    ).toEqual({ left: null, right: null });
  });

  it("builds sticky bottom patch when tools do not apply", () => {
    expect(stickyBottomPanelPatch(true, true, "storage")).toEqual({
      show_quick_cmd_bar: false,
      show_serial_send_panel: false,
    });
    expect(stickyBottomPanelPatch(true, false, "sshShell")).toBeNull();
  });
});

describe("isSftpOnlyPane", () => {
  it("detects pane and live-session sftp runtime", () => {
    expect(isSftpOnlyPane(pane({ sshRuntimeMode: "sftp" }), null)).toBe(true);
    expect(isSftpOnlyPane(pane({ type: "Local" }), null)).toBe(false);
    const sessions = new Map<string, SessionInfo>([
      ["session-1", { id: "session-1", ssh_runtime_mode: "sftp" } as SessionInfo],
    ]);
    expect(isSftpOnlyPane(pane({ type: "SSH" }), sessions)).toBe(true);
  });
});
