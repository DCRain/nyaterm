import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildStyledSpan,
  mergeInlineStyle,
  normalizeInlineColor,
  normalizeInlineFontSize,
  parseExactStyledSpan,
  patchToCssMap,
  removeInlineStyleKeys,
} from "./inlineTextStyle";
import { sanitizeInlineStyle } from "./markdownHtmlSchema";
import { applyInlineTextStyle, clearInlineTextStyle } from "./noteMarkdownActions";

const views: EditorView[] = [];

function createView(doc: string, from: number, to = from) {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: from, head: to },
    }),
  });
  views.push(view);
  return view;
}

afterEach(() => {
  while (views.length > 0) {
    views.pop()?.destroy();
  }
});

describe("inlineTextStyle validation", () => {
  it("accepts safe colors and rejects unsafe ones", () => {
    expect(normalizeInlineColor("#e06c75")).toBe("#e06c75");
    expect(normalizeInlineColor("#ABC")).toBe("#abc");
    expect(normalizeInlineColor("red")).toBe("red");
    expect(normalizeInlineColor("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(normalizeInlineColor("url(javascript:alert(1))")).toBeUndefined();
    expect(normalizeInlineColor("red; position:fixed")).toBeUndefined();
  });

  it("only accepts preset font sizes", () => {
    expect(normalizeInlineFontSize("14px")).toBe("14px");
    expect(normalizeInlineFontSize("18PX")).toBe("18px");
    expect(normalizeInlineFontSize("13px")).toBeUndefined();
    expect(normalizeInlineFontSize("calc(1em + 2px)")).toBeUndefined();
  });

  it("merges style patches without dropping unrelated properties", () => {
    expect(mergeInlineStyle("font-weight: 600", { color: "#ff0000" })).toBe(
      "font-weight: 600; color: #ff0000",
    );
    expect(patchToCssMap({ backgroundColor: "url(x)" })).toEqual({});
  });

  it("removes keys and unwraps empty style maps", () => {
    expect(removeInlineStyleKeys("color: red; font-size: 14px", ["color"])).toBe("font-size: 14px");
    expect(removeInlineStyleKeys("color: red", ["color"])).toBeUndefined();
  });

  it("parses exact styled spans and rejects nested spans", () => {
    expect(parseExactStyledSpan('<span style="color: red">hi</span>')).toEqual({
      beforeAttrs: "",
      style: "color: red",
      afterAttrs: "",
      content: "hi",
    });
    expect(
      parseExactStyledSpan('<span style="color: red"><span style="x">hi</span></span>'),
    ).toBeNull();
    expect(buildStyledSpan("hi", "color: red")).toBe('<span style="color: red">hi</span>');
  });
});

describe("applyInlineTextStyle / clearInlineTextStyle", () => {
  it("wraps a plain selection in a styled span", () => {
    const view = createView("hello world", 0, 5);
    expect(applyInlineTextStyle(view, { color: "#e06c75" })).toBe(true);
    expect(view.state.doc.toString()).toBe('<span style="color: #e06c75">hello</span> world');
  });

  it("merges color and font-size onto an existing span", () => {
    const source = '<span style="color: red">hello</span>';
    const view = createView(source, 0, source.length);
    expect(applyInlineTextStyle(view, { fontSize: "16px" })).toBe(true);
    expect(view.state.doc.toString()).toBe('<span style="color: red; font-size: 16px">hello</span>');
  });

  it("rejects invalid style values", () => {
    const view = createView("hello", 0, 5);
    expect(applyInlineTextStyle(view, { color: "url(javascript:alert(1))" })).toBe(false);
    expect(applyInlineTextStyle(view, { fontSize: "13px" })).toBe(false);
    expect(view.state.doc.toString()).toBe("hello");
  });

  it("clears styles and unwraps when empty", () => {
    const source = '<span style="color: red; font-size: 14px">hello</span>';
    const view = createView(source, 0, source.length);
    expect(clearInlineTextStyle(view, ["color"])).toBe(true);
    expect(view.state.doc.toString()).toBe('<span style="font-size: 14px">hello</span>');
    expect(clearInlineTextStyle(view, ["fontSize"])).toBe(true);
    expect(view.state.doc.toString()).toBe("hello");
  });

  it("inserts a styled placeholder when there is no selection", () => {
    const view = createView("abc", 1);
    expect(applyInlineTextStyle(view, { backgroundColor: "#fef3c7" })).toBe(true);
    expect(view.state.doc.toString()).toBe('a<span style="background-color: #fef3c7">text</span>bc');
  });
});

describe("toolbar style strings survive sanitizeInlineStyle", () => {
  it("keeps typical toolbar outputs", () => {
    expect(sanitizeInlineStyle("color: #e06c75; background-color: #fef3c7; font-size: 16px")).toBe(
      "color: #e06c75; background-color: #fef3c7; font-size: 16px",
    );
  });
});
