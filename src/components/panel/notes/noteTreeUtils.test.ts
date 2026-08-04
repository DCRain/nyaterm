import { describe, expect, it } from "vitest";
import type { NoteFolder, NoteSummary } from "@/types/notes";
import {
  buildNoteTree,
  filterNoteTree,
  flattenNoteFolders,
  flattenVisibleNoteTree,
  isDescendantFolder,
} from "./noteTreeUtils";

describe("note tree utils", () => {
  it("builds and flattens visible rows with stable depth", () => {
    const tree = buildNoteTree(folders(), notes());

    const rows = flattenVisibleNoteTree(tree, new Set(["folder-root", "folder-child"]));

    expect(rows.map(({ node, depth }) => `${depth}:${node.name}`)).toEqual([
      "0:Root",
      "1:Child",
      "2:Nested note",
      "1:Root note",
      "0:Loose note",
    ]);
  });

  it("filters by matching descendants while keeping ancestors", () => {
    const tree = buildNoteTree(folders(), notes());

    const filtered = filterNoteTree(tree, "nested");

    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("Root");
    expect(filtered[0].children[0].name).toBe("Child");
    expect(filtered[0].children[0].children[0].name).toBe("Nested note");
  });

  it("flattens folder move targets and detects descendants", () => {
    const tree = buildNoteTree(folders(), notes());

    expect(flattenNoteFolders(tree).map(({ node, depth }) => `${depth}:${node.name}`)).toEqual([
      "0:Root",
      "1:Child",
    ]);
    expect(isDescendantFolder(tree, "folder-root", "folder-child")).toBe(true);
    expect(isDescendantFolder(tree, "folder-child", "folder-root")).toBe(false);
  });
});

function folders(): NoteFolder[] {
  return [
    {
      id: "folder-root",
      parent_id: null,
      name: "Root",
      sort_order: 0,
      created_at_ms: 1,
      updated_at_ms: 1,
    },
    {
      id: "folder-child",
      parent_id: "folder-root",
      name: "Child",
      sort_order: 0,
      created_at_ms: 1,
      updated_at_ms: 1,
    },
  ];
}

function notes(): NoteSummary[] {
  return [
    {
      id: "note-nested",
      parent_id: "folder-child",
      title: "Nested note",
      sort_order: 0,
      revision: 1,
      created_at_ms: 1,
      updated_at_ms: 1,
    },
    {
      id: "note-root",
      parent_id: "folder-root",
      title: "Root note",
      sort_order: 1,
      revision: 1,
      created_at_ms: 1,
      updated_at_ms: 1,
    },
    {
      id: "note-loose",
      parent_id: null,
      title: "Loose note",
      sort_order: 1,
      revision: 1,
      created_at_ms: 1,
      updated_at_ms: 1,
    },
  ];
}
