import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@/lib/invoke";
import type { FileDocumentPane } from "@/types/global";
import { FilePreviewContent } from "./FilePreviewContent";

vi.mock("@/lib/invoke", () => ({ invoke: vi.fn() }));
vi.mock("./FileDocumentEditor", () => ({
  default: ({ pane }: { pane: FileDocumentPane }) => (
    <div data-testid="file-editor">{pane.file.initial.content}</div>
  ),
}));

describe("FilePreviewContent modes", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it.each([
    ["notes.md", "# Raw markdown"],
    ["data.csv", "name,value\nalpha,1"],
    ["config.json", '{"compact":true}'],
  ])("edits the raw UTF-8 content for %s without reading it again", (name, content) => {
    const pane: FileDocumentPane = {
      id: `pane-${name}`,
      kind: "leaf",
      paneKind: "file",
      sessionId: "session-1",
      name,
      type: "SSH",
      connectionId: "connection-1",
      file: {
        backend: "remote",
        path: `/tmp/${name}`,
        initial: { content, size: content.length, mtime: 1, contentHash: `hash:${name}` },
      },
    };

    render(<FilePreviewContent mode="edit" pane={pane} />);

    expect(screen.getByTestId("file-editor").textContent).toBe(content);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps markdown rendering in explicit preview mode", async () => {
    vi.mocked(invoke).mockResolvedValue({
      path: "/tmp/notes.md",
      content: "# Preview heading",
      size: 17,
      mtime: 1,
      contentHash: "hash-preview",
    });

    render(
      <FilePreviewContent
        mode="preview"
        data={{
          sessionId: "session-1",
          backend: "remote",
          path: "/tmp/notes.md",
          name: "notes.md",
          size: 17,
          mtime: 1,
        }}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Preview heading" })).not.toBeNull();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenCalledWith("read_remote_file_text", {
      sessionId: "session-1",
      path: "/tmp/notes.md",
      maxBytes: 5 * 1024 * 1024,
    });
  });
});
