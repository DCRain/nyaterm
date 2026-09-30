import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedConnection, TerminalSessionPane } from "@/types/global";
import {
  createSessionForConnection,
  createSessionForPane,
  isRdpFileTransferEnabled,
  resolveRdpClipboardMode,
} from "./appSessionFactory";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/lib/invoke", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn() }));

describe("resolveRdpClipboardMode", () => {
  it("prefers pane display and falls back to the saved connection", () => {
    const connection = {
      id: "rdp-1",
      type: "rdp",
      clipboard: { mode: "text-and-files" },
    } as SavedConnection;

    expect(resolveRdpClipboardMode({ clipboardMode: "text-only" }, connection)).toBe("text-only");
    expect(resolveRdpClipboardMode(undefined, connection)).toBe("text-and-files");
    expect(isRdpFileTransferEnabled(undefined, connection)).toBe(true);
    expect(isRdpFileTransferEnabled({ clipboardMode: "text-only" }, connection)).toBe(false);
  });
});

describe("SSH runtime mode creation", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue("session-1");
  });

  it("sends the explicit SFTP runtime through the existing create command", async () => {
    const connection = { id: "ssh-1", type: "ssh" } as SavedConnection;

    await createSessionForConnection(connection, "request-1", undefined, "sftp");

    expect(invokeMock).toHaveBeenCalledWith("create_ssh_session", {
      connectionId: "ssh-1",
      createRequestId: "request-1",
      startupCommand: null,
      runtimeMode: "sftp",
      recordingScopeId: undefined,
    });
  });

  it("reuses the pane runtime for reconnect and startup restoration", async () => {
    const pane = {
      id: "pane-1",
      type: "SSH",
      connectionId: "ssh-1",
      sshRuntimeMode: "sftp",
    } as TerminalSessionPane;

    await createSessionForPane(pane, "request-2");

    expect(invokeMock).toHaveBeenCalledWith("create_ssh_session", {
      connectionId: "ssh-1",
      createRequestId: "request-2",
      startupCommand: null,
      runtimeMode: "sftp",
      recordingScopeId: "pane-1",
    });
  });

  it("passes an explicit directory to a duplicated saved local terminal", async () => {
    const pane = {
      id: "pane-local",
      type: "Local",
      connectionId: "local-1",
    } as TerminalSessionPane;
    await createSessionForPane(pane, "request-local", undefined, "D:\\My Files");
    expect(invokeMock).toHaveBeenCalledWith("create_local_session", {
      connectionId: "local-1",
      createRequestId: "request-local",
      workingDir: "D:\\My Files",
      recordingScopeId: "pane-local",
    });
  });
});
