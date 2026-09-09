import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedConnection, TerminalSessionPane } from "@/types/global";
import { createSessionForConnection, createSessionForPane } from "./appSessionFactory";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/lib/invoke", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn() }));

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
    });
  });

  it("reuses the pane runtime for reconnect and startup restoration", async () => {
    const pane = {
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
    });
  });
});
