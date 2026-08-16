import { describe, expect, it } from "vitest";
import {
  hardenMarkdownNewlines,
  prepareNoteMarkdownForPreview,
  wrapAsciiDiagrams,
} from "./markdownHardBreaks";

describe("hardenMarkdownNewlines", () => {
  it("adds hard breaks between adjacent non-blank lines", () => {
    const input = ["hello", "world"].join("\n");
    expect(hardenMarkdownNewlines(input)).toBe(["hello  ", "world"].join("\n"));
  });

  it("hardens pipe box lines that are not real tables", () => {
    const input = ["┌─ box ─┐", "| line  |", "| line2 |", "└───────┘"].join("\n");
    expect(hardenMarkdownNewlines(input)).toBe(
      ["┌─ box ─┐  ", "| line  |  ", "| line2 |  ", "└───────┘"].join("\n"),
    );
  });

  it("does not harden real GFM tables", () => {
    const input = ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n");
    expect(hardenMarkdownNewlines(input)).toBe(input);
  });

  it("skips fenced code blocks", () => {
    const input = ["```", "a", "b", "```", "c", "d"].join("\n");
    expect(hardenMarkdownNewlines(input)).toBe(["```", "a", "b", "```", "c  ", "d"].join("\n"));
  });
});

describe("wrapAsciiDiagrams", () => {
  it("wraps box-drawing blocks in a text fence", () => {
    const input = ["intro", "", "┌─ box ─┐", "│ line  │", "└───────┘", "", "outro"].join("\n");
    expect(wrapAsciiDiagrams(input)).toBe(
      ["intro", "", "```text", "┌─ box ─┐", "│ line  │", "└───────┘", "```", "", "outro"].join(
        "\n",
      ),
    );
  });
});

describe("prepareNoteMarkdownForPreview", () => {
  it("keeps diagram lines intact after preprocess", () => {
    const input = [
      "### title",
      "",
      "┌─ 共享头 ───",
      "| [只读] 合同编号",
      "| [可填] 合同金额",
      "└────────",
    ].join("\n");
    const prepared = prepareNoteMarkdownForPreview(input);
    expect(prepared).toContain("```text");
    expect(prepared).toContain("| [只读] 合同编号");
    expect(prepared).toContain("| [可填] 合同金额");
  });
});
