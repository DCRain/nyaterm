import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RdpSessionPane, Tab, TerminalSessionPane, VncSessionPane } from "@/types/global";
import PaneWorkspace from "./PaneWorkspace";

const { rdpPaneHostMock, vncPaneHostMock, xTerminalMock } = vi.hoisted(() => ({
  rdpPaneHostMock: vi.fn(),
  vncPaneHostMock: vi.fn(),
  xTerminalMock: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    tabs: [],
    syncGroups: [],
    broadcastToAll: false,
    setSyncGroups: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/rdp/RdpPaneHost", () => ({
  default: (props: unknown) => {
    rdpPaneHostMock(props);
    return <div data-testid="rdp-pane-host" />;
  },
}));

vi.mock("@/components/vnc/VncPaneHost", () => ({
  default: (props: unknown) => {
    vncPaneHostMock(props);
    return <div data-testid="vnc-pane-host" />;
  },
}));

vi.mock("./XTerminal", () => ({
  default: (props: unknown) => {
    xTerminalMock(props);
    return <div data-testid="x-terminal" />;
  },
}));

describe("PaneWorkspace RDP routing", () => {
  beforeEach(() => {
    rdpPaneHostMock.mockReset();
    vncPaneHostMock.mockReset();
    xTerminalMock.mockReset();
  });

  it("routes RDP leaves to RdpPaneHost with active and visible state", () => {
    const onActivatePane = vi.fn();
    const onDisconnectedCloseRequested = vi.fn();
    const onConnectionError = vi.fn();
    const tab = tabWithRoot(rdpPane(), "rdp-pane");

    const view = render(
      <PaneWorkspace
        tab={tab}
        visible
        onActivatePane={onActivatePane}
        onUpdateSplitRatio={vi.fn()}
        onDisconnectedCloseRequested={onDisconnectedCloseRequested}
        onConnectionError={onConnectionError}
      />,
    );

    expect(rdpPaneHostMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pane: tab.root,
        active: true,
        visible: true,
      }),
    );
    expect(xTerminalMock).not.toHaveBeenCalled();

    const rdpHost = view.getByTestId("rdp-pane-host");
    fireEvent.mouseDown(rdpHost.parentElement as HTMLElement);
    expect(onActivatePane).toHaveBeenCalledWith("rdp-pane");

    const rdpProps = rdpPaneHostMock.mock.lastCall?.[0] as {
      onDisconnectedCloseRequested: () => void;
      onConnectionError: (sessionId: string, error: string) => void;
    };
    rdpProps.onDisconnectedCloseRequested();
    rdpProps.onConnectionError("rdp-session", "RDP failed");
    expect(onDisconnectedCloseRequested).toHaveBeenCalledWith("tab-1", "rdp-pane");
    expect(onConnectionError).toHaveBeenCalledWith(
      "tab-1",
      "rdp-pane",
      "rdp-session",
      "RDP failed",
    );
  });

  it("keeps terminal leaves on XTerminal in a mixed split tree", () => {
    const onUpdateSplitRatio = vi.fn();
    const tab = tabWithRoot(
      {
        id: "split-1",
        kind: "split",
        direction: "vertical",
        ratio: 0.4,
        first: terminalPane(),
        second: rdpPane(),
      },
      "terminal-pane",
    );

    const view = render(
      <PaneWorkspace
        tab={tab}
        visible
        onActivatePane={vi.fn()}
        onUpdateSplitRatio={onUpdateSplitRatio}
      />,
    );

    expect(xTerminalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "terminal-session",
        sessionType: "SSH",
        active: true,
        visible: true,
      }),
    );
    expect(rdpPaneHostMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pane: expect.objectContaining({ id: "rdp-pane", paneKind: "remote-desktop" }),
        active: false,
        visible: true,
      }),
    );
    expect(view.getAllByTestId(/(?:x-terminal|rdp-pane-host)/)).toHaveLength(2);
  });

  it("routes VNC leaves to VncPaneHost without invoking RDP or terminal hosts", () => {
    const tab = tabWithRoot(vncPane(), "vnc-pane");
    const view = render(
      <PaneWorkspace tab={tab} visible onActivatePane={vi.fn()} onUpdateSplitRatio={vi.fn()} />,
    );

    expect(view.getByTestId("vnc-pane-host")).not.toBeNull();
    expect(vncPaneHostMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pane: tab.root,
        active: true,
        visible: true,
      }),
    );
    expect(rdpPaneHostMock).not.toHaveBeenCalled();
    expect(xTerminalMock).not.toHaveBeenCalled();
  });

  it("does not mark an active RDP leaf active while its tab is hidden", () => {
    const tab = tabWithRoot(rdpPane(), "rdp-pane");
    const view = render(
      <PaneWorkspace
        tab={tab}
        visible={false}
        onActivatePane={vi.fn()}
        onUpdateSplitRatio={vi.fn()}
      />,
    );

    expect((view.container.firstElementChild as HTMLElement).style.display).toBe("none");
    expect(rdpPaneHostMock).toHaveBeenCalledWith(
      expect.objectContaining({ active: false, visible: false }),
    );
  });
});

function tabWithRoot(root: Tab["root"], activePaneId: string): Tab {
  return {
    id: "tab-1",
    persistOrder: 0,
    activePaneId,
    root,
  };
}

function rdpPane(): RdpSessionPane {
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
  };
}

function vncPane(): VncSessionPane {
  return {
    id: "vnc-pane",
    kind: "leaf",
    paneKind: "remote-desktop",
    sessionId: "vnc-session",
    name: "VNC Desktop",
    type: "VNC",
    connectionId: "vnc-connection",
    display: { scaleMode: "fit" },
  };
}

function terminalPane(): TerminalSessionPane {
  return {
    id: "terminal-pane",
    kind: "leaf",
    paneKind: "terminal",
    sessionId: "terminal-session",
    name: "SSH Terminal",
    type: "SSH",
    connectionId: "ssh-connection",
  };
}
