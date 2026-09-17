import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RdpSessionPane } from "@/types/global";
import RdpPaneHost from "./RdpPaneHost";

const { invokeMock, listenMock, listeners, openFileDialogMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  openFileDialogMock: vi.fn(),
}));

vi.mock("@/lib/invoke", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class Channel<T> {
    onmessage: (message: T) => void;

    constructor(onmessage: (message: T) => void) {
      this.onmessage = onmessage;
    }
  },
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openFileDialogMock,
}));

vi.mock("@/context/TransferContext", () => ({
  useTransfer: () => ({
    upsertExternalTransferProgress: vi.fn(),
    completeExternalTransfer: vi.fn(),
    failExternalTransfer: vi.fn(),
  }),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    appSettings: {
      rdp: {
        special_shortcuts: [],
      },
    },
    updateAppSettings: vi.fn(),
  }),
}));

vi.mock("@/components/remote-desktop/RdpShortcutPopover", () => ({
  RdpShortcutPopover: () => <div data-testid="rdp-shortcut-popover" />,
}));

describe("RdpPaneHost", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    listenMock.mockReset();
    listeners.clear();
    openFileDialogMock.mockReset();
    openFileDialogMock.mockResolvedValue(null);
    listenMock.mockImplementation(
      (eventName: string, handler: (event: { payload: unknown }) => void) => {
        listeners.set(eventName, handler);
        return Promise.resolve(vi.fn());
      },
    );
  });

  it("attaches the frame channel and subscribes to session-scoped events", async () => {
    render(<RdpPaneHost pane={rdpPane()} active visible />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("rdp_attach_frame_channel", {
        sessionId: "rdp-session",
        frameChannel: expect.any(Object),
      });
    });
    expect(listenMock).toHaveBeenCalledWith("rdp-state-rdp-session", expect.any(Function));
    expect(listenMock).toHaveBeenCalledWith("rdp-pointer-rdp-session", expect.any(Function));
  });

  it("forwards state failures using the existing callback payload", async () => {
    const onConnectionError = vi.fn();
    render(<RdpPaneHost pane={rdpPane()} active visible onConnectionError={onConnectionError} />);

    await waitFor(() => expect(listeners.has("rdp-state-rdp-session")).toBe(true));
    act(() => {
      listeners.get("rdp-state-rdp-session")?.({
        payload: {
          sessionId: "rdp-session",
          state: "failed",
          message: "certificate rejected",
        },
      });
    });

    expect(screen.getByText("certificate rejected")).not.toBeNull();
    expect(onConnectionError).toHaveBeenCalledWith("rdp-session", "certificate rejected");
  });

  it("sends the existing physical keyboard wire payload after activation", async () => {
    render(<RdpPaneHost pane={rdpPane()} active visible />);

    await waitFor(() => expect(listeners.has("rdp-state-rdp-session")).toBe(true));
    act(() => {
      listeners.get("rdp-state-rdp-session")?.({
        payload: { sessionId: "rdp-session", state: "active" },
      });
    });

    invokeMock.mockClear();
    const inputRoot = document.querySelector('[data-rdp-input-root="true"]');
    if (!(inputRoot instanceof HTMLElement)) throw new Error("expected RDP input root");
    fireEvent.keyDown(inputRoot, { code: "ControlLeft", key: "Control" });
    fireEvent.keyUp(inputRoot, { code: "ControlLeft", key: "Control" });

    expect(invokeMock).toHaveBeenCalledWith("rdp_input_batch", {
      sessionId: "rdp-session",
      events: [
        {
          type: "key-down",
          scanCode: 0x1d,
          extended: false,
          repeat: false,
        },
      ],
    });
    expect(invokeMock).toHaveBeenCalledWith("rdp_input_batch", {
      sessionId: "rdp-session",
      events: [
        {
          type: "key-up",
          scanCode: 0x1d,
          extended: false,
          repeat: false,
        },
      ],
    });
  });

  it("ignores repeated keydown events while a key is held", async () => {
    render(<RdpPaneHost pane={rdpPane()} active visible />);

    await waitFor(() => expect(listeners.has("rdp-state-rdp-session")).toBe(true));
    act(() => {
      listeners.get("rdp-state-rdp-session")?.({
        payload: { sessionId: "rdp-session", state: "active" },
      });
    });

    invokeMock.mockClear();
    const inputRoot = document.querySelector('[data-rdp-input-root="true"]');
    if (!(inputRoot instanceof HTMLElement)) throw new Error("expected RDP input root");
    fireEvent.keyDown(inputRoot, { code: "ShiftLeft", key: "Shift", repeat: false });
    fireEvent.keyDown(inputRoot, { code: "ShiftLeft", key: "Shift", repeat: true });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("rdp_input_batch", {
      sessionId: "rdp-session",
      events: [
        {
          type: "key-down",
          scanCode: 0x2a,
          extended: false,
          repeat: false,
        },
      ],
    });
  });

  it("renders floating session chrome after the session becomes active", async () => {
    const onDisconnectedCloseRequested = vi.fn();
    render(
      <RdpPaneHost
        pane={rdpPane()}
        active
        visible
        onDisconnectedCloseRequested={onDisconnectedCloseRequested}
      />,
    );

    expect(document.querySelector('[data-floating-session-chrome="true"]')).toBeNull();

    await waitFor(() => expect(listeners.has("rdp-state-rdp-session")).toBe(true));
    act(() => {
      listeners.get("rdp-state-rdp-session")?.({
        payload: { sessionId: "rdp-session", state: "active" },
      });
    });

    await waitFor(() => {
      expect(document.querySelector('[data-floating-session-chrome="true"]')).not.toBeNull();
    });
    expect(screen.getByText("Windows Desktop")).not.toBeNull();
    expect(screen.getByText("1920x1080")).not.toBeNull();
    expect(screen.getByTestId("rdp-shortcut-popover")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "dialog.rdpReconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "dialog.remoteDesktopChromeClose" }));
    expect(invokeMock).toHaveBeenCalledWith("rdp_reconnect", { sessionId: "rdp-session" });
    expect(onDisconnectedCloseRequested).toHaveBeenCalledOnce();
  });

  it("offers selected local files through the floating chrome transfer button", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    openFileDialogMock.mockResolvedValue(["C:\\tmp\\a.txt", "C:\\tmp\\b.txt"]);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "resolve_local_drop_paths") {
        return [
          { path: "C:\\tmp\\a.txt", isDirectory: false },
          { path: "C:\\tmp\\b.txt", isDirectory: false },
        ];
      }
      if (command === "rdp_offer_local_files") {
        return 2;
      }
      return undefined;
    });

    render(
      <RdpPaneHost
        pane={rdpPane({
          display: {
            remoteWidth: 1920,
            remoteHeight: 1080,
            scaleMode: "fit",
            clipboardMode: "text-and-files",
          },
        })}
        active
        visible
      />,
    );

    await waitFor(() => expect(listeners.has("rdp-state-rdp-session")).toBe(true));
    act(() => {
      listeners.get("rdp-state-rdp-session")?.({
        payload: { sessionId: "rdp-session", state: "active" },
      });
    });

    const transferButton = await screen.findByRole("button", {
      name: "dialog.rdpTransferFiles",
    });
    fireEvent.click(transferButton);

    await waitFor(() => {
      expect(openFileDialogMock).toHaveBeenCalledWith({ multiple: true, directory: false });
      expect(invokeMock).toHaveBeenCalledWith("rdp_offer_local_files", {
        sessionId: "rdp-session",
        paths: ["C:\\tmp\\a.txt", "C:\\tmp\\b.txt"],
        autoPaste: false,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("rdp_input_batch", {
        sessionId: "rdp-session",
        events: [
          { type: "mouse-move", x: 960, y: 540 },
          {
            type: "mouse-button",
            button: "left",
            pressed: true,
            x: 960,
            y: 540,
          },
          {
            type: "mouse-button",
            button: "left",
            pressed: false,
            x: 960,
            y: 540,
          },
        ],
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("rdp_input_batch", {
        sessionId: "rdp-session",
        events: [
          { type: "key-down", scanCode: 0x1d, extended: false, repeat: false },
          { type: "key-down", scanCode: 0x2f, extended: false, repeat: false },
          { type: "key-up", scanCode: 0x2f, extended: false, repeat: false },
          { type: "key-up", scanCode: 0x1d, extended: false, repeat: false },
        ],
      });
    });

    vi.useRealTimers();
  });

  it("clears keyboard capture and releases keys when the window blurs", async () => {
    render(<RdpPaneHost pane={rdpPane()} active visible />);

    await waitFor(() => expect(listeners.has("rdp-state-rdp-session")).toBe(true));
    act(() => {
      listeners.get("rdp-state-rdp-session")?.({
        payload: { sessionId: "rdp-session", state: "active" },
      });
    });

    invokeMock.mockClear();
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(invokeMock).toHaveBeenCalledWith("rdp_set_keyboard_capture", { sessionId: null });
    expect(invokeMock).toHaveBeenCalledWith("rdp_input_batch", {
      sessionId: "rdp-session",
      events: [{ type: "release-all-keys" }],
    });
  });

  it("releases keys on document hide even when no keys are tracked locally", async () => {
    render(<RdpPaneHost pane={rdpPane()} active visible />);

    await waitFor(() => expect(listeners.has("rdp-state-rdp-session")).toBe(true));
    act(() => {
      listeners.get("rdp-state-rdp-session")?.({
        payload: { sessionId: "rdp-session", state: "active" },
      });
    });

    invokeMock.mockClear();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });

    expect(invokeMock).toHaveBeenCalledWith("rdp_set_keyboard_capture", { sessionId: null });
    expect(invokeMock).toHaveBeenCalledWith("rdp_input_batch", {
      sessionId: "rdp-session",
      events: [{ type: "release-all-keys" }],
    });
  });

  it("hides the transfer button when clipboard mode is not text-and-files", async () => {
    render(
      <RdpPaneHost
        pane={rdpPane({
          display: {
            remoteWidth: 1920,
            remoteHeight: 1080,
            scaleMode: "fit",
            clipboardMode: "text-only",
          },
        })}
        active
        visible
      />,
    );

    await waitFor(() => expect(listeners.has("rdp-state-rdp-session")).toBe(true));
    act(() => {
      listeners.get("rdp-state-rdp-session")?.({
        payload: { sessionId: "rdp-session", state: "active" },
      });
    });

    await waitFor(() => {
      expect(document.querySelector('[data-floating-session-chrome="true"]')).not.toBeNull();
    });
    expect(screen.queryByRole("button", { name: "dialog.rdpTransferFiles" })).toBeNull();
  });
});

function rdpPane(overrides: Partial<RdpSessionPane> = {}): RdpSessionPane {
  return {
    id: "rdp-pane",
    kind: "leaf",
    paneKind: "remote-desktop",
    sessionId: "rdp-session",
    name: "Windows Desktop",
    type: "RDP",
    connectionId: "rdp-connection",
    display: {
      remoteWidth: 1920,
      remoteHeight: 1080,
      scaleMode: "fit",
    },
    ...overrides,
  };
}
