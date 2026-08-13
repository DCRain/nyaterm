import { describe, expect, it } from "vitest";
import { createTerminalWindowLeaf, serializeTerminalWindowLayout } from "./tabWindows";
import { createFileDocumentPane, createSessionPane, createWorkspaceTab } from "./workspaceTabs";

describe("terminal window persistence", () => {
  it("indexes window tabs against the restorable tab list", () => {
    const fileTab = createWorkspaceTab(
      createFileDocumentPane({
        sessionId: "session-ssh",
        name: "notes.md",
        type: "SSH",
        connectionId: "ssh-1",
        backend: "remote",
        path: "/srv/notes.md",
        file: { content: "notes", size: 5, mtime: 42 },
      }),
      0,
    );
    const terminalTab = createWorkspaceTab(
      createSessionPane("Host", "SSH", "ssh-1", {
        sessionId: "session-ssh",
      }),
      1,
    );
    const layout = createTerminalWindowLeaf([fileTab.id, terminalTab.id], terminalTab.id);

    expect(serializeTerminalWindowLayout(layout, [fileTab, terminalTab])).toEqual({
      kind: "leaf",
      tab_indexes: [0],
      active_tab_index: 0,
    });
  });
});
