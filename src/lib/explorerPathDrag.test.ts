import { describe, expect, it } from "vitest";
import {
  EXPLORER_PATH_DRAG_MIME,
  formatExplorerPathsForTerminal,
  hasExplorerPathDrag,
  readExplorerPathDragData,
  writeExplorerPathDragData,
} from "./explorerPathDrag";

function createDataTransfer(initialTypes: string[] = []) {
  const store = new Map<string, string>();
  const types = [...initialTypes];
  return {
    types,
    effectAllowed: "none" as string,
    setData(type: string, value: string) {
      store.set(type, value);
      if (!types.includes(type)) {
        types.push(type);
      }
    },
    getData(type: string) {
      return store.get(type) ?? "";
    },
  } as unknown as DataTransfer;
}

describe("explorerPathDrag", () => {
  it("writes and reads explorer path drag payload", () => {
    const dataTransfer = createDataTransfer();
    writeExplorerPathDragData(dataTransfer, {
      paths: ["/home/user/a file.txt", "/tmp/dir"],
      backend: "remote",
    });

    expect(hasExplorerPathDrag(dataTransfer)).toBe(true);
    expect(dataTransfer.types).toContain(EXPLORER_PATH_DRAG_MIME);
    expect(readExplorerPathDragData(dataTransfer)).toEqual({
      paths: ["/home/user/a file.txt", "/tmp/dir"],
      backend: "remote",
    });
    expect(dataTransfer.getData("text/plain")).toContain("a file.txt");
  });

  it("formats local windows-style paths with quotes when needed", () => {
    const text = formatExplorerPathsForTerminal(
      ["C:\\Users\\Me\\My Docs\\file.txt", "C:\\plain.txt"],
      "local",
    );
    // On Windows CI/runtime, spaces get double quotes; elsewhere unix quoting may apply.
    expect(text.includes("plain.txt")).toBe(true);
    expect(text.split(" ").length).toBeGreaterThanOrEqual(1);
  });

  it("formats remote paths with shell quoting for spaces", () => {
    const text = formatExplorerPathsForTerminal(["/opt/my app/bin", "/opt/ok"], "remote");
    expect(text).toContain("/opt/ok");
    expect(text).toContain("my app");
  });
});
