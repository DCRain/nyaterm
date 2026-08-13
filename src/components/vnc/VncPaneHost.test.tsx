import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VncSessionPane } from "@/types/global";
import VncPaneHost from "./VncPaneHost";

const { invokeMock, listenMock, listeners, readClipboardTextMock, writeClipboardTextMock } =
  vi.hoisted(() => ({
    invokeMock: vi.fn(),
    listenMock: vi.fn(),
    listeners: new Map<string, (event: { payload: unknown }) => void>(),
    readClipboardTextMock: vi.fn(),
    writeClipboardTextMock: vi.fn(),
  }));

vi.mock("@/lib/invoke", () => ({
  invoke: invokeMock,
}));

vi.mock("@/lib/clipboard", () => ({
  readClipboardText: readClipboardTextMock,
  writeClipboardText: writeClipboardTextMock,
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

describe("VncPaneHost", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    readClipboardTextMock.mockReset();
    readClipboardTextMock.mockResolvedValue("");
    writeClipboardTextMock.mockReset();
    writeClipboardTextMock.mockResolvedValue(undefined);
    listenMock.mockReset();
    listeners.clear();
    listenMock.mockImplementation(
      (eventName: string, handler: (event: { payload: unknown }) => void) => {
        listeners.set(eventName, handler);
        return Promise.resolve(vi.fn());
      },
    );
  });

  it("attaches the frame channel and subscribes to VNC state", async () => {
    render(<VncPaneHost pane={vncPane()} active visible />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("vnc_attach_frame_channel", {
        sessionId: "vnc-session",
        frameChannel: expect.any(Object),
      });
    });
    expect(listenMock).toHaveBeenCalledWith("vnc-state-vnc-session", expect.any(Function));
  });

  it("forwards state failures", async () => {
    const onConnectionError = vi.fn();
    render(<VncPaneHost pane={vncPane()} active visible onConnectionError={onConnectionError} />);

    await waitFor(() => expect(listeners.has("vnc-state-vnc-session")).toBe(true));
    act(() => {
      listeners.get("vnc-state-vnc-session")?.({
        payload: {
          sessionId: "vnc-session",
          state: "failed",
          message: "unsupported security",
        },
      });
    });

    expect(screen.getByText("unsupported security")).not.toBeNull();
    expect(onConnectionError).toHaveBeenCalledWith("vnc-session", "unsupported security");
  });

  it("sends keysym keyboard events only when active", async () => {
    render(<VncPaneHost pane={vncPane()} active visible />);
    await activate();
    invokeMock.mockClear();

    const root = document.querySelector('[data-remote-desktop-input-root="true"]');
    if (!(root instanceof HTMLElement)) throw new Error("expected VNC input root");
    fireEvent.keyDown(root, { key: "ArrowLeft", code: "ArrowLeft" });
    fireEvent.keyUp(root, { key: "ArrowLeft", code: "ArrowLeft" });

    expect(invokeMock).toHaveBeenCalledWith("vnc_input_batch", {
      sessionId: "vnc-session",
      events: [{ type: "key", keysym: 0xff51, pressed: true }],
    });
    expect(invokeMock).toHaveBeenCalledWith("vnc_input_batch", {
      sessionId: "vnc-session",
      events: [{ type: "key", keysym: 0xff51, pressed: false }],
    });
  });

  it("does not send local input for view-only panes", async () => {
    render(
      <VncPaneHost
        pane={vncPane({ display: { scaleMode: "fit", viewOnly: true } })}
        active
        visible
      />,
    );
    await activate();
    invokeMock.mockClear();

    const root = document.querySelector('[data-remote-desktop-input-root="true"]');
    if (!(root instanceof HTMLElement)) throw new Error("expected VNC input root");
    fireEvent.keyDown(root, { key: "ArrowLeft", code: "ArrowLeft" });

    expect(invokeMock).not.toHaveBeenCalledWith("vnc_input_batch", expect.anything());
  });

  it("keeps reconnect and close controls wired", async () => {
    const onDisconnectedCloseRequested = vi.fn();
    render(
      <VncPaneHost
        pane={vncPane()}
        active
        visible
        onDisconnectedCloseRequested={onDisconnectedCloseRequested}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reconnect VNC session" }));
    fireEvent.click(screen.getByRole("button", { name: "Close VNC session" }));

    expect(invokeMock).toHaveBeenCalledWith("vnc_reconnect", { sessionId: "vnc-session" });
    expect(onDisconnectedCloseRequested).toHaveBeenCalledOnce();
  });

  it("writes remote clipboard events to the local clipboard when enabled and focused", async () => {
    render(
      <VncPaneHost
        pane={vncPane({ display: { scaleMode: "fit", clipboardEnabled: true } })}
        active
        visible
      />,
    );
    await activate();
    await waitFor(() => expect(listeners.has("vnc-clipboard-vnc-session")).toBe(true));

    act(() => {
      listeners.get("vnc-clipboard-vnc-session")?.({
        payload: { sessionId: "vnc-session", text: "remote" },
      });
    });

    expect(writeClipboardTextMock).toHaveBeenCalledWith("remote");
  });

  it("does not subscribe to remote clipboard events when clipboard is disabled", async () => {
    render(
      <VncPaneHost
        pane={vncPane({ display: { scaleMode: "fit", clipboardEnabled: false } })}
        active
        visible
      />,
    );
    await activate();

    expect(listeners.has("vnc-clipboard-vnc-session")).toBe(false);
  });

  it("polls local clipboard and sends changed Latin-1 text to the VNC server", async () => {
    readClipboardTextMock.mockResolvedValue("local");
    render(
      <VncPaneHost
        pane={vncPane({ display: { scaleMode: "fit", clipboardEnabled: true } })}
        active
        visible
      />,
    );
    await activate();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("vnc_set_clipboard_text", {
        sessionId: "vnc-session",
        text: "local",
      });
    });
  });

  it("does not send local clipboard text for view-only panes", async () => {
    readClipboardTextMock.mockResolvedValue("local");
    render(
      <VncPaneHost
        pane={vncPane({
          display: { scaleMode: "fit", clipboardEnabled: true, viewOnly: true },
        })}
        active
        visible
      />,
    );
    await activate();
    invokeMock.mockClear();

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(invokeMock).not.toHaveBeenCalledWith("vnc_set_clipboard_text", expect.anything());
  });
});

async function activate() {
  await waitFor(() => expect(listeners.has("vnc-state-vnc-session")).toBe(true));
  act(() => {
    listeners.get("vnc-state-vnc-session")?.({
      payload: { sessionId: "vnc-session", state: "active" },
    });
  });
}

function vncPane(overrides: Partial<VncSessionPane> = {}): VncSessionPane {
  return {
    id: "vnc-pane",
    kind: "leaf",
    paneKind: "remote-desktop",
    sessionId: "vnc-session",
    name: "VNC Desktop",
    type: "VNC",
    connectionId: "vnc-connection",
    display: { scaleMode: "fit" },
    ...overrides,
  };
}
