import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RemoteGpuOverviewState } from "@/hooks/useRemoteGpuOverview";
import type { RemoteNpuOverviewState } from "@/hooks/useRemoteNpuOverview";
import type { RemoteStatsState } from "@/hooks/useRemoteStats";
import type { FileDocumentPane } from "@/types/global";
import AppPanelContent from "./AppPanelContent";

const { fileExplorerMock, fileTransferMock } = vi.hoisted(() => ({
  fileExplorerMock: vi.fn(),
  fileTransferMock: vi.fn(),
}));

vi.mock("@/components/panel/file-explorer", () => ({
  default: (props: unknown) => {
    fileExplorerMock(props);
    return null;
  },
}));

vi.mock("@/components/panel/file-explorer/FileTransfer", () => ({
  default: (props: unknown) => {
    fileTransferMock(props);
    return null;
  },
}));

function renderFileExplorer(activePane: FileDocumentPane) {
  return render(
    <AppPanelContent
      panelId="fileExplorer"
      activePane={activePane}
      activeConnection={null}
      activeSessionId={null}
      activeStatsSessionId={null}
      remoteStatsEnabled={false}
      remoteStats={{} as RemoteStatsState}
      gpuMonitorEnabled={false}
      gpuOverviewState={{} as RemoteGpuOverviewState}
      npuMonitorEnabled={false}
      npuOverviewState={{} as RemoteNpuOverviewState}
      recordingStatuses={[]}
      aiIntent={null}
      transferHeight={180}
      onTransferResize={vi.fn()}
      onTemporarySshLink={vi.fn()}
      onNewConnection={vi.fn()}
      onEditConnection={vi.fn()}
      onConnectConnection={vi.fn()}
      onSessionClick={vi.fn()}
      onSessionReconnect={vi.fn()}
      onSessionDisconnect={vi.fn()}
      canReconnect={() => false}
      onCommandSend={vi.fn()}
      onToggleSessionRecording={vi.fn()}
      onSaveSessionTranscript={vi.fn()}
    />,
  );
}

describe("AppPanelContent file explorer", () => {
  it("keeps Files and Transfers attached to the session used by an active file pane", () => {
    const pane: FileDocumentPane = {
      id: "pane-file",
      kind: "leaf",
      paneKind: "file",
      sessionId: "session-1",
      name: "notes.txt",
      type: "SSH",
      connectionId: "connection-1",
      file: {
        backend: "remote",
        path: "/tmp/notes.txt",
        initial: {
          content: "notes",
          size: 5,
          mtime: 1,
          contentHash: "hash-notes",
        },
      },
    };

    renderFileExplorer(pane);

    expect(fileExplorerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeSessionId: "session-1",
        activeSessionType: "SSH",
        activeConnectionId: "connection-1",
        activeSessionName: null,
      }),
    );
    expect(fileTransferMock).toHaveBeenCalledWith(
      expect.objectContaining({ activeSessionId: "session-1" }),
    );
  });
});
