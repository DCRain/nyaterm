import { defaultKeymap, history, historyKeymap, indentLess, insertTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useTheme } from "@/context/ThemeContext";
import type { NoteColors } from "@/lib/themes";

export interface NoteMarkdownEditorHandle {
  setMarkdown: (markdown: string) => void;
  getMarkdown: () => string;
  getView: () => EditorView | null;
  focus: () => void;
}

interface NoteMarkdownEditorProps {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  /** Fired when the CodeMirror view is created (after host has a real size). */
  onReady?: (view: EditorView) => void;
  className?: string;
}

const MIN_HOST_WIDTH = 120;
const MIN_HOST_HEIGHT = 48;
const GUTTER_WIDTH_PX = 44;
const GUTTER_DIVIDER_CLASS = "nyaterm-gutter-divider";
const LINE_NUMBER_FONT_PX = 11;
const EDITOR_PADDING_Y_PX = 16;
const EDITOR_PADDING_X_PX = 20;
/** Vertical inset on `.cm-content`. Horizontal padding lives on `.cm-line` so active-line fill can span scroll width. */
const EDITOR_CONTENT_PADDING = `${EDITOR_PADDING_Y_PX}px 0`;
const EDITOR_LINE_PADDING_X = `${EDITOR_PADDING_X_PX}px`;

/** Stroke aligned with the rest of note chrome (`--df-border`). */
function noteStrokeColor(colors: NoteColors): string {
  return colors.border;
}

function ensureGutterDivider(gutters: HTMLElement, color: string) {
  gutters.style.setProperty("position", "sticky", "important");
  gutters.style.setProperty("overflow", "visible", "important");
  let divider = gutters.querySelector(`:scope > .${GUTTER_DIVIDER_CLASS}`) as HTMLElement | null;
  if (!divider) {
    divider = gutters.ownerDocument.createElement("div");
    divider.className = GUTTER_DIVIDER_CLASS;
    divider.setAttribute("aria-hidden", "true");
    gutters.appendChild(divider);
  }
  divider.style.cssText = [
    "position:absolute",
    "top:0",
    "right:0",
    "bottom:0",
    "width:1px",
    "min-width:1px",
    `background:${color}`,
    "pointer-events:none",
    "z-index:5",
  ].join(";");
}

/** Force line-number chrome — CM/WebView2 often overwrites theme CSS after layout. */
function styleLineNumberElements(root: ParentNode) {
  const nodes = root.querySelectorAll(".cm-lineNumbers .cm-gutterElement");
  for (const node of nodes) {
    const el = node as HTMLElement;
    el.style.setProperty("display", "flex", "important");
    el.style.setProperty("align-items", "center", "important");
    el.style.setProperty("justify-content", "flex-end", "important");
    el.style.setProperty("box-sizing", "border-box", "important");
    el.style.setProperty("padding", "0 10px 0 4px", "important");
    el.style.setProperty("min-width", "1.25rem", "important");
    el.style.setProperty("text-align", "right", "important");
    el.style.setProperty("font-size", `${LINE_NUMBER_FONT_PX}px`, "important");
    el.style.setProperty("line-height", "1.65", "important");
  }
}

function styleActiveLines(root: ParentNode, hoverColor: string) {
  for (const node of root.querySelectorAll(".cm-line")) {
    const el = node as HTMLElement;
    el.style.setProperty("display", "block", "important");
    el.style.setProperty("box-sizing", "border-box", "important");
    el.style.setProperty("min-width", "100%", "important");
    el.style.setProperty("width", "max-content", "important");
    el.style.setProperty("padding-left", EDITOR_LINE_PADDING_X, "important");
    el.style.setProperty("padding-right", EDITOR_LINE_PADDING_X, "important");
    el.style.setProperty("margin-left", "0", "important");
    el.style.setProperty("margin-right", "0", "important");
    if (el.classList.contains("cm-activeLine")) {
      el.style.setProperty("background-color", hoverColor, "important");
    } else {
      el.style.setProperty("background-color", "transparent", "important");
    }
  }
  for (const node of root.querySelectorAll(".cm-lineNumbers .cm-gutterElement")) {
    const el = node as HTMLElement;
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("box-sizing", "border-box", "important");
    if (el.classList.contains("cm-activeLineGutter")) {
      el.style.setProperty("background-color", hoverColor, "important");
    } else {
      el.style.setProperty("background-color", "transparent", "important");
    }
  }
}

function isDarkColor(color: string) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return true;
  let r = 0;
  let g = 0;
  let b = 0;
  if (match[1].length === 3) {
    r = Number.parseInt(match[1][0] + match[1][0], 16);
    g = Number.parseInt(match[1][1] + match[1][1], 16);
    b = Number.parseInt(match[1][2] + match[1][2], 16);
  } else {
    r = Number.parseInt(match[1].slice(0, 2), 16);
    g = Number.parseInt(match[1].slice(2, 4), 16);
    b = Number.parseInt(match[1].slice(4, 6), 16);
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
}

function noteHighlightStyle(colors: NoteColors) {
  const syn = colors.syntax;
  return HighlightStyle.define([
    {
      tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment, tags.meta],
      color: syn.brightBlack || colors.textMuted,
      fontStyle: "italic",
    },
    {
      tag: [
        tags.keyword,
        tags.controlKeyword,
        tags.definitionKeyword,
        tags.moduleKeyword,
        tags.operatorKeyword,
      ],
      color: syn.magenta || colors.primary,
    },
    {
      tag: [tags.operator, tags.definitionOperator, tags.punctuation, tags.separator],
      color: colors.textMuted,
    },
    {
      tag: [tags.string, tags.docString, tags.character, tags.attributeValue],
      color: syn.green || colors.link,
    },
    {
      tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null, tags.atom],
      color: syn.yellow || colors.primary,
    },
    {
      tag: [tags.regexp, tags.escape, tags.url],
      color: syn.cyan || colors.link,
    },
    {
      tag: [tags.className, tags.typeName, tags.namespace, tags.tagName],
      color: syn.blue || colors.link,
    },
    {
      tag: [
        tags.function(tags.variableName),
        tags.function(tags.propertyName),
        tags.definition(tags.variableName),
        tags.definition(tags.propertyName),
      ],
      color: syn.blue || colors.link,
    },
    {
      tag: [tags.propertyName, tags.attributeName, tags.labelName],
      color: syn.cyan || colors.link,
    },
    {
      tag: [tags.constant(tags.variableName), tags.standard(tags.variableName), tags.macroName],
      color: syn.yellow || colors.primary,
    },
    {
      tag: [tags.deleted, tags.invalid],
      color: syn.red || colors.danger,
    },
    {
      tag: [tags.inserted, tags.changed],
      color: syn.green || colors.link,
    },
    {
      tag: tags.heading,
      color: colors.primary,
      fontWeight: "600",
    },
    {
      tag: [tags.emphasis],
      fontStyle: "italic",
    },
    {
      tag: [tags.strong],
      fontWeight: "600",
    },
  ]);
}

function noteEditorTheme(colors: NoteColors) {
  const selection = colors.selectionBackground || `${colors.primary}66`;
  const caret = colors.syntax.cursor || colors.text;
  const surface = colors.bgPanel;
  const text = colors.text;
  return Prec.highest(
    EditorView.theme(
      {
        "&": {
          height: "100%",
          width: "100%",
          fontSize: "14px",
          backgroundColor: surface,
          color: text,
          caretColor: caret,
          border: "none",
          outline: "none",
          boxShadow: "none",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        },
        "&.cm-focused": {
          outline: "none",
          border: "none",
          boxShadow: "none",
        },
        ".cm-scroller": {
          fontFamily: "ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Consolas, monospace",
          backgroundColor: surface,
          color: text,
          overflow: "auto",
          flex: "1 1 auto",
          minHeight: "0",
          minWidth: "0",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "row",
          /* flex-start is required for CM scroll; stretch collapses scrollHeight. */
          alignItems: "flex-start",
          border: "none",
          outline: "none",
        },
        ".cm-gutters": {
          flex: `0 0 ${GUTTER_WIDTH_PX}px`,
          alignSelf: "stretch",
          width: `${GUTTER_WIDTH_PX}px`,
          minWidth: `${GUTTER_WIDTH_PX}px`,
          maxWidth: `${GUTTER_WIDTH_PX}px`,
          boxSizing: "border-box",
          backgroundColor: surface,
          color: colors.textMuted,
          /* Real divider DOM is injected — CSS borders vanish in release WebView2. */
          borderRight: "none",
          boxShadow: "none",
          position: "sticky",
          left: "0",
          zIndex: "200",
          overflow: "visible",
          fontSize: `${LINE_NUMBER_FONT_PX}px`,
        },
        ".cm-gutter.cm-lineNumbers": {
          width: `${GUTTER_WIDTH_PX}px`,
          minWidth: `${GUTTER_WIDTH_PX}px`,
          maxWidth: `${GUTTER_WIDTH_PX}px`,
        },
        ".cm-lineNumbers .cm-gutterElement": {
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          padding: "0 10px 0 4px",
          minWidth: "1.25rem",
          textAlign: "right",
          fontSize: `${LINE_NUMBER_FONT_PX}px`,
          lineHeight: "1.65",
          boxSizing: "border-box",
        },
        ".cm-activeLineGutter": {
          backgroundColor: colors.bgHover,
        },
        ".cm-content": {
          padding: EDITOR_CONTENT_PADDING,
          lineHeight: "1.65",
          caretColor: caret,
          color: text,
          backgroundColor: surface,
          fontSize: "14px",
          minHeight: "0px",
          flex: "1 0 auto",
          minWidth: "min-content",
          outline: "none",
          border: "none",
        },
        ".cm-line": {
          color: text,
          display: "block",
          boxSizing: "border-box",
          minWidth: "100%",
          width: "max-content",
          paddingLeft: EDITOR_LINE_PADDING_X,
          paddingRight: EDITOR_LINE_PADDING_X,
        },
        ".cm-content ::selection": {
          backgroundColor: selection,
        },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: caret,
        },
        ".cm-activeLine": {
          backgroundColor: colors.bgHover,
        },
      },
      { dark: isDarkColor(surface) },
    ),
  );
}

/** Keep CM gutters at a fixed pixel width — release WebView2 otherwise stretches them. */
const gutterDividerColorRef = { current: "transparent" };
const gutterHoverColorRef = { current: "transparent" };

const clampNativeGutters = ViewPlugin.fromClass(
  class {
    view: EditorView;
    scheduled = false;

    constructor(view: EditorView) {
      this.view = view;
      this.apply(view);
      this.schedule();
    }

    update(update: ViewUpdate) {
      this.view = update.view;
      if (
        update.geometryChanged ||
        update.viewportChanged ||
        update.docChanged ||
        update.selectionSet
      ) {
        this.schedule();
      }
    }

    schedule() {
      if (this.scheduled) return;
      this.scheduled = true;
      // Run after CM writes gutter heights/fonts so our !important styles stick.
      requestAnimationFrame(() => {
        this.scheduled = false;
        this.apply(this.view);
      });
    }

    apply(view: EditorView) {
      const stroke = gutterDividerColorRef.current;
      const nodes = view.scrollDOM.querySelectorAll(".cm-gutters");
      for (const node of nodes) {
        const el = node as HTMLElement;
        el.style.setProperty("flex", `0 0 ${GUTTER_WIDTH_PX}px`, "important");
        el.style.setProperty("width", `${GUTTER_WIDTH_PX}px`, "important");
        el.style.setProperty("min-width", `${GUTTER_WIDTH_PX}px`, "important");
        el.style.setProperty("max-width", `${GUTTER_WIDTH_PX}px`, "important");
        el.style.setProperty("box-sizing", "border-box", "important");
        el.style.setProperty("border-right", "none", "important");
        el.style.setProperty("box-shadow", "none", "important");
        el.style.setProperty("z-index", "200", "important");
        el.style.setProperty("overflow", "visible", "important");
        el.style.setProperty("align-self", "stretch", "important");
        el.style.setProperty("font-size", `${LINE_NUMBER_FONT_PX}px`, "important");
        ensureGutterDivider(el, stroke);
      }
      styleLineNumberElements(view.scrollDOM);
      styleActiveLines(view.scrollDOM, gutterHoverColorRef.current);
      const scroller = view.scrollDOM;
      scroller.style.setProperty("display", "flex", "important");
      scroller.style.setProperty("flex-direction", "row", "important");
      scroller.style.setProperty("align-items", "flex-start", "important");
      scroller.style.setProperty("flex", "1 1 auto", "important");
      scroller.style.setProperty("min-height", "0", "important");
      scroller.style.setProperty("min-width", "0", "important");
      scroller.style.setProperty("overflow", "auto", "important");
      scroller.style.setProperty("height", "auto", "important");
      scroller.style.setProperty("max-height", "none", "important");
      const content = view.contentDOM;
      content.style.setProperty("flex", "1 0 auto", "important");
      content.style.setProperty("min-width", "min-content", "important");
      content.style.setProperty("padding", EDITOR_CONTENT_PADDING, "important");
      content.style.setProperty("box-sizing", "border-box", "important");
      content.style.setProperty("outline", "none", "important");
      content.style.setProperty("box-shadow", "none", "important");
      content.style.setProperty("border", "none", "important");
    }
  },
);

function buildExtensions(
  colors: NoteColors,
  themeCompartment: Compartment,
  highlightCompartment: Compartment,
  onDocChange: (markdown: string) => void,
  suppressChangeRef: { current: boolean },
) {
  return [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    clampNativeGutters,
    history(),
    markdown(),
    search({ top: true }),
    EditorState.allowMultipleSelections.of(true),
    keymap.of([
      { key: "Tab", run: insertTab },
      { key: "Shift-Tab", run: indentLess },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || suppressChangeRef.current) return;
      onDocChange(update.state.doc.toString());
    }),
    highlightCompartment.of(syntaxHighlighting(noteHighlightStyle(colors))),
    themeCompartment.of(noteEditorTheme(colors)),
  ];
}

/**
 * CodeMirror in an opaque iframe (release + transparent HWND). Uses native
 * lineNumbers with a hard width clamp — custom external rails broke scroll sync.
 */
const NoteMarkdownEditor = forwardRef<NoteMarkdownEditorHandle, NoteMarkdownEditorProps>(
  function NoteMarkdownEditor({ initialMarkdown, onChange, onReady, className }, ref) {
    const { noteTheme } = useTheme();
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const themeCompartmentRef = useRef(new Compartment());
    const highlightCompartmentRef = useRef(new Compartment());
    const onChangeRef = useRef(onChange);
    const onReadyRef = useRef(onReady);
    const suppressChangeRef = useRef(false);
    const initialMarkdownRef = useRef(initialMarkdown);
    const colors = noteTheme.colors.notes;
    const colorsRef = useRef(colors);
    colorsRef.current = colors;
    gutterDividerColorRef.current = noteStrokeColor(colors);
    gutterHoverColorRef.current = colors.bgHover;

    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
      onReadyRef.current = onReady;
    }, [onReady]);

    useImperativeHandle(
      ref,
      () => ({
        setMarkdown: (markdownDoc: string) => {
          const view = viewRef.current;
          if (!view) return;
          if (view.state.doc.toString() === markdownDoc) return;
          suppressChangeRef.current = true;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: markdownDoc },
          });
          suppressChangeRef.current = false;
        },
        getMarkdown: () => viewRef.current?.state.doc.toString() ?? "",
        getView: () => viewRef.current,
        focus: () => viewRef.current?.focus(),
      }),
      [],
    );

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;

      let cancelled = false;
      let view: EditorView | null = null;
      let iframe: HTMLIFrameElement | null = null;
      let resizeObserver: ResizeObserver | null = null;
      let forwardKeydown: ((event: KeyboardEvent) => void) | null = null;

      const destroy = () => {
        resizeObserver?.disconnect();
        resizeObserver = null;
        if (forwardKeydown && iframe?.contentDocument) {
          iframe.contentDocument.removeEventListener("keydown", forwardKeydown, true);
        }
        forwardKeydown = null;
        if (view) {
          view.destroy();
          if (viewRef.current === view) viewRef.current = null;
          view = null;
        }
        iframe?.remove();
        iframe = null;
        iframeRef.current = null;
      };

      const readHostSize = () => {
        const rect = host.getBoundingClientRect();
        return {
          width: Math.max(0, Math.floor(rect.width)),
          height: Math.max(0, Math.floor(rect.height)),
        };
      };

      const syncIframeBox = () => {
        if (!iframe) return { width: 0, height: 0 };
        const { width, height } = readHostSize();
        iframe.width = String(Math.max(width, 1));
        iframe.height = String(Math.max(height, 1));
        iframe.style.width = `${width}px`;
        iframe.style.height = `${height}px`;
        const root = iframe.contentDocument?.getElementById("cm-root");
        if (root) {
          root.style.width = `${width}px`;
          root.style.height = `${height}px`;
        }
        if (view) {
          view.dom.style.width = `${width}px`;
          view.dom.style.height = `${height}px`;
        }
        return { width, height };
      };

      const mountWhenReady = () => {
        if (cancelled || view) return;
        const { width, height } = readHostSize();
        if (width < MIN_HOST_WIDTH || height < MIN_HOST_HEIGHT) return;

        const palette = colorsRef.current;
        const surface = palette.bgPanel;
        const text = palette.text;
        const muted = palette.textMuted;
        const border = noteStrokeColor(palette);
        gutterDividerColorRef.current = border;
        gutterHoverColorRef.current = palette.bgHover;
        const scheme = isDarkColor(surface) ? "dark" : "light";

        iframe = document.createElement("iframe");
        iframe.title = "Note editor";
        iframe.setAttribute("aria-label", "Note editor");
        iframe.setAttribute("frameborder", "0");
        iframe.setAttribute("scrolling", "no");
        iframe.tabIndex = -1;
        iframe.style.cssText = [
          "border:0",
          "outline:0",
          "box-shadow:none",
          "display:block",
          "margin:0",
          "padding:0",
          "position:absolute",
          "inset:0",
          `width:${width}px`,
          `height:${height}px`,
          `background:${surface}`,
          `color-scheme:${scheme}`,
        ].join(";");
        host.replaceChildren(iframe);
        iframeRef.current = iframe;

        const doc = iframe.contentDocument;
        if (!doc) {
          destroy();
          return;
        }

        doc.open();
        doc.write(`<!DOCTYPE html>
<html lang="en" style="width:100%;height:100%;">
<head>
<meta charset="utf-8" />
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: ${surface};
    color: ${text};
    color-scheme: ${scheme};
    border: none !important;
    outline: none !important;
    box-shadow: none !important;
  }
  #cm-root {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: ${surface};
    color: ${text};
    border: none !important;
    outline: none !important;
    box-shadow: none !important;
  }
  .cm-editor {
    height: 100% !important;
    width: 100% !important;
    max-height: 100% !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
    border: none !important;
    outline: none !important;
    box-shadow: none !important;
    background: ${surface} !important;
  }
  .cm-editor,
  .cm-editor.cm-focused,
  .cm-content:focus,
  .cm-scroller:focus,
  [contenteditable="true"]:focus {
    outline: none !important;
    border: none !important;
    box-shadow: none !important;
  }
  [contenteditable="true"] {
    outline: none !important;
  }
  .cm-scroller {
    display: flex !important;
    flex-direction: row !important;
    align-items: flex-start !important;
    flex: 1 1 auto !important;
    min-height: 0 !important;
    min-width: 0 !important;
    height: auto !important;
    max-height: none !important;
    box-sizing: border-box !important;
    overflow: auto !important;
    border: none !important;
    outline: none !important;
  }
  .cm-gutters {
    flex: 0 0 ${GUTTER_WIDTH_PX}px !important;
    align-self: stretch !important;
    width: ${GUTTER_WIDTH_PX}px !important;
    min-width: ${GUTTER_WIDTH_PX}px !important;
    max-width: ${GUTTER_WIDTH_PX}px !important;
    box-sizing: border-box !important;
    background: ${surface} !important;
    color: ${muted} !important;
    border-right: none !important;
    box-shadow: none !important;
    position: sticky !important;
    left: 0 !important;
    z-index: 200 !important;
    overflow: visible !important;
    font-size: ${LINE_NUMBER_FONT_PX}px !important;
  }
  .${GUTTER_DIVIDER_CLASS} {
    position: absolute !important;
    top: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: 1px !important;
    min-width: 1px !important;
    background: ${border} !important;
    pointer-events: none !important;
    z-index: 5 !important;
  }
  .cm-gutter.cm-lineNumbers {
    width: ${GUTTER_WIDTH_PX}px !important;
    min-width: ${GUTTER_WIDTH_PX}px !important;
    max-width: ${GUTTER_WIDTH_PX}px !important;
  }
  .cm-lineNumbers .cm-gutterElement {
    display: flex !important;
    align-items: center !important;
    justify-content: flex-end !important;
    box-sizing: border-box !important;
    padding: 0 10px 0 4px !important;
    min-width: 1.25rem !important;
    text-align: right !important;
    font-size: ${LINE_NUMBER_FONT_PX}px !important;
    line-height: 1.65 !important;
  }
  .cm-activeLine {
    background: ${palette.bgHover} !important;
  }
  .cm-activeLineGutter {
    width: 100% !important;
    box-sizing: border-box !important;
    background: ${palette.bgHover} !important;
  }
  .cm-content {
    flex: 1 0 auto !important;
    min-width: min-content !important;
    padding: ${EDITOR_CONTENT_PADDING} !important;
    box-sizing: border-box !important;
    outline: none !important;
    border: none !important;
  }
  .cm-line {
    display: block !important;
    box-sizing: border-box !important;
    min-width: 100% !important;
    width: max-content !important;
    padding-left: ${EDITOR_LINE_PADDING_X} !important;
    padding-right: ${EDITOR_LINE_PADDING_X} !important;
  }
  .cm-scroller::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  .cm-scroller::-webkit-scrollbar-button,
  .cm-scroller::-webkit-scrollbar-button:single-button,
  .cm-scroller::-webkit-scrollbar-button:vertical:decrement,
  .cm-scroller::-webkit-scrollbar-button:vertical:increment,
  .cm-scroller::-webkit-scrollbar-corner {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
    background: transparent !important;
  }
  .cm-scroller::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, ${text} 28%, transparent);
    border-radius: 999px;
  }
  .cm-scroller::-webkit-scrollbar-track {
    background: transparent;
  }
  .cm-scroller {
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, ${text} 28%, transparent) transparent;
  }
</style>
</head>
<body>
  <div id="cm-root"></div>
</body>
</html>`);
        doc.close();

        const parent = doc.getElementById("cm-root");
        if (!parent) {
          destroy();
          return;
        }

        syncIframeBox();
        view = new EditorView({
          parent,
          doc: initialMarkdownRef.current,
          extensions: buildExtensions(
            palette,
            themeCompartmentRef.current,
            highlightCompartmentRef.current,
            (next) => onChangeRef.current(next),
            suppressChangeRef,
          ),
        });
        view.dom.style.setProperty("border", "none", "important");
        view.dom.style.setProperty("outline", "none", "important");
        view.dom.style.setProperty("box-shadow", "none", "important");
        view.dom.style.setProperty("overflow", "hidden", "important");
        view.dom.style.setProperty("display", "flex", "important");
        view.dom.style.setProperty("flex-direction", "column", "important");
        view.scrollDOM.style.setProperty("border", "none", "important");
        view.scrollDOM.style.setProperty("outline", "none", "important");
        view.scrollDOM.style.setProperty("box-shadow", "none", "important");
        view.contentDOM.style.setProperty("padding", EDITOR_CONTENT_PADDING, "important");
        view.contentDOM.style.setProperty("box-sizing", "border-box", "important");
        viewRef.current = view;
        syncIframeBox();
        view.requestMeasure();
        view.dispatch({
          selection: { anchor: 0 },
          effects: EditorView.scrollIntoView(0),
        });
        onReadyRef.current?.(view);

        forwardKeydown = (event: KeyboardEvent) => {
          if (!(event.ctrlKey || event.metaKey || event.altKey) && !event.key.startsWith("F")) {
            return;
          }
          const forwarded = new KeyboardEvent("keydown", {
            key: event.key,
            code: event.code,
            location: event.location,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            repeat: event.repeat,
            bubbles: true,
            cancelable: true,
          });
          const parentHandled =
            !window.dispatchEvent(forwarded) || forwarded.defaultPrevented;
          if (parentHandled) {
            event.preventDefault();
            event.stopPropagation();
          }
        };
        doc.addEventListener("keydown", forwardKeydown, true);

        requestAnimationFrame(() => {
          if (cancelled || !view) return;
          syncIframeBox();
          view.requestMeasure();
        });
      };

      mountWhenReady();
      resizeObserver = new ResizeObserver(() => {
        if (!view) {
          mountWhenReady();
          return;
        }
        syncIframeBox();
        view.requestMeasure();
      });
      resizeObserver.observe(host);

      return () => {
        cancelled = true;
        destroy();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- remount via parent key
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      const iframe = iframeRef.current;
      if (!view) return;

      gutterDividerColorRef.current = noteStrokeColor(colors);
      gutterHoverColorRef.current = colors.bgHover;
      view.dispatch({
        effects: [
          themeCompartmentRef.current.reconfigure(noteEditorTheme(colors)),
          highlightCompartmentRef.current.reconfigure(
            syntaxHighlighting(noteHighlightStyle(colors)),
          ),
        ],
      });
      for (const node of view.scrollDOM.querySelectorAll(".cm-gutters")) {
        ensureGutterDivider(node as HTMLElement, gutterDividerColorRef.current);
      }
      styleLineNumberElements(view.scrollDOM);
      styleActiveLines(view.scrollDOM, gutterHoverColorRef.current);

      const surface = colors.bgPanel;
      const text = colors.text;
      const scheme = isDarkColor(surface) ? "dark" : "light";
      if (iframe) {
        iframe.style.background = surface;
        iframe.style.colorScheme = scheme;
      }
      const doc = iframe?.contentDocument;
      if (doc?.documentElement) {
        doc.documentElement.style.background = surface;
        doc.documentElement.style.color = text;
        doc.body.style.background = surface;
        doc.body.style.color = text;
        const root = doc.getElementById("cm-root");
        if (root) {
          root.style.background = surface;
          root.style.color = text;
        }
      }
      view.requestMeasure();
    }, [colors]);

    return (
      <div
        ref={hostRef}
        className={
          className ?? "nyaterm-solid-surface absolute inset-0 min-h-0 min-w-0 overflow-hidden"
        }
        style={{
          backgroundColor: colors.bgPanel,
          color: colors.text,
          colorScheme: isDarkColor(colors.bgPanel) ? "dark" : "light",
          boxShadow: "none",
          outline: "none",
          border: "none",
        }}
      />
    );
  },
);

export default NoteMarkdownEditor;
