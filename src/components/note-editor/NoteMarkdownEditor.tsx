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
          height: "100%",
          maxHeight: "100%",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "row",
          alignItems: "stretch",
          border: "none",
          outline: "none",
        },
        ".cm-gutters": {
          flex: `0 0 ${GUTTER_WIDTH_PX}px`,
          width: `${GUTTER_WIDTH_PX}px`,
          minWidth: `${GUTTER_WIDTH_PX}px`,
          maxWidth: `${GUTTER_WIDTH_PX}px`,
          boxSizing: "border-box",
          backgroundColor: surface,
          color: colors.textMuted,
          /* Keep the divider inside the gutter box — outer shadows are covered by .cm-content. */
          borderRight: `1px solid ${colors.border}`,
          boxShadow: "none",
          position: "sticky",
          left: "0",
          zIndex: "200",
          fontSize: "11px",
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
          fontSize: "11px",
          lineHeight: "1",
        },
        ".cm-activeLineGutter": {
          backgroundColor: colors.bgHover,
        },
        ".cm-content": {
          padding: "12px 16px",
          lineHeight: "1.65",
          caretColor: caret,
          color: text,
          backgroundColor: surface,
          fontSize: "14px",
          minHeight: "0px",
          flex: "1 1 auto",
          minWidth: "0",
          outline: "none",
          border: "none",
        },
        ".cm-line": {
          color: text,
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

const clampNativeGutters = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.apply(view);
    }

    update(update: ViewUpdate) {
      if (update.geometryChanged || update.viewportChanged || update.docChanged) {
        this.apply(update.view);
      }
    }

    apply(view: EditorView) {
      const nodes = view.scrollDOM.querySelectorAll(".cm-gutters");
      for (const node of nodes) {
        const el = node as HTMLElement;
        el.style.setProperty("flex", `0 0 ${GUTTER_WIDTH_PX}px`, "important");
        el.style.setProperty("width", `${GUTTER_WIDTH_PX}px`, "important");
        el.style.setProperty("min-width", `${GUTTER_WIDTH_PX}px`, "important");
        el.style.setProperty("max-width", `${GUTTER_WIDTH_PX}px`, "important");
        el.style.setProperty("box-sizing", "border-box", "important");
        el.style.setProperty(
          "border-right",
          `1px solid ${gutterDividerColorRef.current}`,
          "important",
        );
        el.style.setProperty("box-shadow", "none", "important");
        el.style.setProperty("z-index", "200", "important");
      }
      const scroller = view.scrollDOM;
      scroller.style.setProperty("display", "flex", "important");
      scroller.style.setProperty("flex-direction", "row", "important");
      scroller.style.setProperty("align-items", "stretch", "important");
      const content = view.contentDOM;
      content.style.setProperty("flex", "1 1 auto", "important");
      content.style.setProperty("min-width", "0", "important");
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
    gutterDividerColorRef.current = colors.border;

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
        const border = palette.border;
        const scheme = isDarkColor(surface) ? "dark" : "light";

        iframe = document.createElement("iframe");
        iframe.title = "Note editor";
        iframe.setAttribute("aria-label", "Note editor");
        iframe.style.cssText = [
          "border:0",
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
  }
  #cm-root {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: ${surface};
    color: ${text};
  }
  .cm-editor {
    height: 100% !important;
    width: 100% !important;
    max-height: 100% !important;
  }
  .cm-editor,
  .cm-editor.cm-focused,
  .cm-content:focus {
    outline: none !important;
    border: none !important;
    box-shadow: none !important;
  }
  .cm-scroller {
    display: flex !important;
    flex-direction: row !important;
    align-items: stretch !important;
    box-sizing: border-box !important;
    height: 100% !important;
    max-height: 100% !important;
    overflow: auto !important;
    border: none !important;
    outline: none !important;
  }
  .cm-gutters {
    flex: 0 0 ${GUTTER_WIDTH_PX}px !important;
    width: ${GUTTER_WIDTH_PX}px !important;
    min-width: ${GUTTER_WIDTH_PX}px !important;
    max-width: ${GUTTER_WIDTH_PX}px !important;
    box-sizing: border-box !important;
    background: ${surface} !important;
    color: ${muted} !important;
    border-right: 1px solid ${border} !important;
    box-shadow: none !important;
    position: sticky !important;
    left: 0 !important;
    z-index: 200 !important;
    font-size: 11px !important;
  }
  .cm-gutters::after {
    content: "" !important;
    position: absolute !important;
    top: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: 1px !important;
    background: ${border} !important;
    pointer-events: none !important;
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
    padding: 0 10px 0 4px !important;
    min-width: 1.25rem !important;
    text-align: right !important;
    font-size: 11px !important;
    line-height: 1 !important;
  }
  .cm-content {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    outline: none !important;
    border: none !important;
  }
  .cm-scroller::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  .cm-scroller::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, ${text} 28%, transparent);
    border-radius: 6px;
  }
  .cm-scroller::-webkit-scrollbar-track {
    background: transparent;
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

      gutterDividerColorRef.current = colors.border;
      view.dispatch({
        effects: [
          themeCompartmentRef.current.reconfigure(noteEditorTheme(colors)),
          highlightCompartmentRef.current.reconfigure(
            syntaxHighlighting(noteHighlightStyle(colors)),
          ),
        ],
      });
      for (const node of view.scrollDOM.querySelectorAll(".cm-gutters")) {
        const el = node as HTMLElement;
        el.style.setProperty(
          "border-right",
          `1px solid ${colors.border}`,
          "important",
        );
        el.style.setProperty("box-shadow", "none", "important");
      }

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
