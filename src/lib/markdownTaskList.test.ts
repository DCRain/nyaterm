import { describe, expect, it } from "vitest";
import { countMarkdownTasks, toggleMarkdownTaskAtIndex } from "./markdownTaskList";

describe("markdownTaskList", () => {
  const sample = [
    "# Todo",
    "",
    "- [ ] first",
    "- [x] second",
    "  - [ ] nested",
    "1. [ ] numbered",
    "",
    "```md",
    "- [ ] code fence",
    "```",
    "",
    "- [ ] after fence",
  ].join("\n");

  it("counts task markers outside fenced code blocks", () => {
    expect(countMarkdownTasks(sample)).toBe(5);
  });

  it("toggles the targeted task checkbox", () => {
    expect(toggleMarkdownTaskAtIndex(sample, 0, true)).toContain("- [x] first");
    expect(toggleMarkdownTaskAtIndex(sample, 1, false)).toContain("- [ ] second");
    expect(toggleMarkdownTaskAtIndex(sample, 2, true)).toContain("  - [x] nested");
    expect(toggleMarkdownTaskAtIndex(sample, 3, true)).toContain("1. [x] numbered");
    expect(toggleMarkdownTaskAtIndex(sample, 4, true)).toContain("- [x] after fence");
    expect(toggleMarkdownTaskAtIndex(sample, 4, true)).toContain("- [ ] code fence");
  });

  it("returns the original markdown for out-of-range indices", () => {
    expect(toggleMarkdownTaskAtIndex(sample, 99, true)).toBe(sample);
    expect(toggleMarkdownTaskAtIndex(sample, -1, true)).toBe(sample);
  });
});
