import { describe, expect, it } from "vitest";
import { extractNoteOutline, resolveActiveOutlineLine } from "./noteOutline";

describe("extractNoteOutline", () => {
  it("extracts ATX headings with source lines", () => {
    const md = ["# Title", "", "## Section", "text", "### Nested"].join("\n");
    expect(extractNoteOutline(md)).toEqual([
      { line: 1, level: 1, text: "Title" },
      { line: 3, level: 2, text: "Section" },
      { line: 5, level: 3, text: "Nested" },
    ]);
  });

  it("skips headings inside fenced code", () => {
    const md = ["# Keep", "```", "# Ignore", "```", "## Also keep"].join("\n");
    expect(extractNoteOutline(md)).toEqual([
      { line: 1, level: 1, text: "Keep" },
      { line: 5, level: 2, text: "Also keep" },
    ]);
  });
});

describe("resolveActiveOutlineLine", () => {
  it("picks the nearest heading at or above the current line", () => {
    const items = extractNoteOutline(["# A", "## B", "### C"].join("\n"));
    expect(resolveActiveOutlineLine(items, 1)).toBe(1);
    expect(resolveActiveOutlineLine(items, 2)).toBe(2);
    expect(resolveActiveOutlineLine(items, 99)).toBe(3);
    expect(resolveActiveOutlineLine(items, null)).toBeNull();
  });
});
