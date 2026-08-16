import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import {
  noteMarkdownHtmlRehypePlugins,
  noteMarkdownHtmlSchema,
  sanitizeElementProperties,
  sanitizeInlineStyle,
} from "./markdownHtmlSchema";

function renderMarkdownHtml(markdown: string): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [...noteMarkdownHtmlRehypePlugins],
      },
      markdown,
    ),
  );
}

describe("sanitizeInlineStyle", () => {
  it("keeps safe style declarations", () => {
    expect(sanitizeInlineStyle("color: red; text-align: center")).toBe(
      "color: red; text-align: center",
    );
  });

  it("drops unsafe properties and values", () => {
    expect(sanitizeInlineStyle("color: red; position: fixed")).toBe("color: red");
    expect(sanitizeInlineStyle("background: url(javascript:alert(1))")).toBeUndefined();
    expect(sanitizeInlineStyle("color: expression(alert(1))")).toBeUndefined();
  });
});

describe("sanitizeElementProperties", () => {
  it("strips event handlers and javascript hrefs", () => {
    expect(
      sanitizeElementProperties({
        href: "javascript:alert(1)",
        onClick: "alert(1)",
        style: "color: blue; position: absolute",
      }),
    ).toEqual({ style: "color: blue" });
  });
});

describe("noteMarkdownHtmlSchema", () => {
  it("allows common editor HTML tags", () => {
    const tags = new Set(noteMarkdownHtmlSchema.tagNames ?? []);
    for (const tag of ["u", "br", "kbd", "mark", "details", "summary", "span", "div"]) {
      expect(tags.has(tag)).toBe(true);
    }
  });

  it("renders safe HTML tags from Markdown", () => {
    const html = renderMarkdownHtml(
      'Hello <u>underlined</u><br/>\n<details open><summary>More</summary>Body</details>\n<span style="color: red; position: fixed">red</span>',
    );
    expect(html).toContain("<u>");
    expect(html).toContain("<br");
    expect(html).toContain("<details");
    expect(html).toContain("<summary>");
    expect(html).toMatch(/color:\s*red/);
    expect(html).not.toContain("position");
  });

  it("strips dangerous HTML", () => {
    const html = renderMarkdownHtml(
      '<script>alert(1)</script><a href="javascript:alert(1)">x</a><img src=x onerror="alert(1)">',
    );
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html.toLowerCase()).not.toContain("javascript:");
    expect(html.toLowerCase()).not.toContain("onerror");
  });
});
