import type { Terminal } from "@xterm/xterm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  completePendingZmodemUpload: vi.fn(),
  failPendingZmodemUpload: vi.fn(),
  getPendingZmodemUploadConflictMode: vi.fn(),
  getPendingZmodemUploadPaths: vi.fn(),
  hasPendingZmodemUpload: vi.fn(),
  markPendingZmodemUploadActive: vi.fn(),
  probeAndResolveRemoteConflicts: vi.fn(),
  toastDismiss: vi.fn(),
  toastError: vi.fn(),
  toastMessage: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/terminalZmodemUpload", () => ({
  completePendingZmodemUpload: mocks.completePendingZmodemUpload,
  failPendingZmodemUpload: mocks.failPendingZmodemUpload,
  getPendingZmodemUploadConflictMode: mocks.getPendingZmodemUploadConflictMode,
  getPendingZmodemUploadPaths: mocks.getPendingZmodemUploadPaths,
  hasPendingZmodemUpload: mocks.hasPendingZmodemUpload,
  markPendingZmodemUploadActive: mocks.markPendingZmodemUploadActive,
  probeAndResolveRemoteConflicts: mocks.probeAndResolveRemoteConflicts,
}));
vi.mock("sonner", () => ({
  toast: {
    dismiss: mocks.toastDismiss,
    error: mocks.toastError,
    message: mocks.toastMessage,
    success: mocks.toastSuccess,
  },
}));

import { createZmodemEventHandler } from "./zmodemTerminalEvents";

function createHandler() {
  const writeTerminalStatus = vi.fn();
  const terminal = { write: vi.fn() } as unknown as Terminal;
  const handler = createZmodemEventHandler(
    terminal,
    "ssh-1",
    () => (key) => key,
    () => "ask",
    undefined,
    writeTerminalStatus,
  );
  return { handler, writeTerminalStatus };
}

describe("zmodem detected file pickers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPendingZmodemUploadConflictMode.mockReturnValue("overwrite");
    mocks.getPendingZmodemUploadPaths.mockReturnValue(null);
    mocks.hasPendingZmodemUpload.mockReturnValue(false);
    mocks.probeAndResolveRemoteConflicts.mockResolvedValue({
      paths: [],
      probeSkipped: false,
      conflictMode: "overwrite",
    });
    mocks.toastMessage.mockReturnValue("zmodem-upload");
    mocks.invoke.mockResolvedValue(undefined);
  });

  it("accepts a selected download folder through the ZMODEM picker command", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "zmodem_pick_download_dir") {
        return Promise.resolve("C:\\Downloads");
      }
      return Promise.resolve(undefined);
    });
    const { handler } = createHandler();

    handler.handle({ type: "detected", direction: "download" });

    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("zmodem_accept_download", {
        sessionId: "ssh-1",
        saveDir: "C:\\Downloads",
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("zmodem_pick_download_dir");
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "zmodem_cancel",
      expect.anything(),
    );
  });

  it("cancels ZMODEM when the download folder picker is closed", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "zmodem_pick_download_dir") {
        return Promise.resolve(null);
      }
      return Promise.resolve(undefined);
    });
    const { handler, writeTerminalStatus } = createHandler();

    handler.handle({ type: "detected", direction: "download" });

    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("zmodem_cancel", {
        sessionId: "ssh-1",
      }),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "zmodem_accept_download",
      expect.anything(),
    );
    expect(writeTerminalStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("zmodem.cancelled"),
    );
  });

  it("probes conflicts before accepting files selected for upload", async () => {
    const selectedPaths = ["C:\\tmp\\first.txt", "C:\\tmp\\second.txt"];
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "zmodem_pick_upload_files") {
        return Promise.resolve(selectedPaths);
      }
      return Promise.resolve(undefined);
    });
    mocks.probeAndResolveRemoteConflicts.mockResolvedValue({
      paths: selectedPaths,
      probeSkipped: false,
      conflictMode: "overwrite",
    });
    const { handler } = createHandler();

    handler.handle({ type: "detected", direction: "upload" });

    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("zmodem_accept_upload", {
        sessionId: "ssh-1",
        filePaths: selectedPaths,
        conflictMode: "overwrite",
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("zmodem_pick_upload_files");
    expect(mocks.probeAndResolveRemoteConflicts).toHaveBeenCalledWith(
      "ssh-1",
      selectedPaths,
      "ask",
    );
  });

  it("cancels ZMODEM when the upload file picker is closed", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "zmodem_pick_upload_files") {
        return Promise.resolve(null);
      }
      return Promise.resolve(undefined);
    });
    const { handler, writeTerminalStatus } = createHandler();

    handler.handle({ type: "detected", direction: "upload" });

    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("zmodem_cancel", {
        sessionId: "ssh-1",
      }),
    );
    expect(mocks.probeAndResolveRemoteConflicts).not.toHaveBeenCalled();
    expect(writeTerminalStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("zmodem.cancelled"),
    );
  });

  it("bypasses the picker when upload paths are already pending", async () => {
    const pendingPaths = ["C:\\tmp\\ready.txt"];
    mocks.getPendingZmodemUploadPaths.mockReturnValue(pendingPaths);
    mocks.getPendingZmodemUploadConflictMode.mockReturnValue("skip");
    mocks.hasPendingZmodemUpload.mockReturnValue(true);
    const { handler } = createHandler();

    handler.handle({ type: "detected", direction: "upload" });

    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("zmodem_accept_upload", {
        sessionId: "ssh-1",
        filePaths: pendingPaths,
        conflictMode: "skip",
      }),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith("zmodem_pick_upload_files");
    expect(mocks.probeAndResolveRemoteConflicts).not.toHaveBeenCalled();
  });
});
