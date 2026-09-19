import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentLess, insertTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sass as sassLanguage } from "@codemirror/lang-sass";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { csharp, dart } from "@codemirror/legacy-modes/mode/clike";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { fSharp } from "@codemirror/legacy-modes/mode/mllike";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { r } from "@codemirror/legacy-modes/mode/r";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { vb } from "@codemirror/legacy-modes/mode/vb";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  scrollPastEnd,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { ThemeColors } from "@/lib/themes";

export interface CursorPosition {
  line: number;
  column: number;
}

/** Simple relative-luminance check for literal hex colors (iframe color-scheme hinting). */
export function isDarkColor(color: string): boolean {
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

/**
 * Tauri injects a fresh per-load CSP nonce into the `style-src` directive
 * (`style-src 'self' 'unsafe-inline' 'nonce-XXXX'`). Per the CSP spec, once a
 * directive contains a nonce-source, browsers ignore `'unsafe-inline'` for
 * that directive entirely. CodeMirror renders its entire theme + syntax
 * highlighting through dynamically-created `<style>` tags (via style-mod),
 * which don't carry that nonce — so release WebView2 silently refuses to
 * activate them as real stylesheets (`style.sheet` stays `null`, verified via
 * CDP `CSS.getMatchedStylesForNode`), even though the tags/text are present
 * in the DOM. Only JS-applied inline styles render. This is invisible in
 * `pnpm tauri dev` because the Vite dev server doesn't send Tauri's CSP
 * header at all.
 *
 * Fix: find the nonce Tauri attached to whatever tag it nonced (varies by
 * build; discovered empirically to be a `<style>` element) and feed it to
 * CodeMirror's `EditorView.cspNonce` facet, which style-mod's `StyleModule.mount`
 * uses when creating its own `<style>` elements. Don't rely on the CSS
 * `[nonce]` attribute selector — most engines intentionally hide it there —
 * read the `.nonce` IDL property directly, which is always exposed to
 * same-document scripts.
 */
function getCspNonce(): string {
  if (typeof document === "undefined") return "";
  for (const el of document.querySelectorAll("style, script, link")) {
    const nonce = (el as HTMLElement & { nonce?: string }).nonce;
    if (nonce) return nonce;
  }
  return "";
}

/** Layout constants shared by iframe chrome CSS and the clamp plugin. */
export const FILE_VIEW_LINE_NUMBER_GUTTER_PX = 52;
export const FILE_VIEW_FOLD_GUTTER_PX = 18;
export const FILE_VIEW_LINE_NUMBER_FONT_PX = 11;
export const FILE_VIEW_LINE_PADDING_X = "12px";
export const FILE_VIEW_CONTENT_PADDING_Y = "8px";

interface FileViewExtensionOptions {
  editable?: boolean;
  updateListener?: Extension;
  /** Allow scrolling past the last line (default true). */
  allowScrollPastEnd?: boolean;
  /** Soft-wrap long lines (default true). Disable for large notes to avoid scroll blanks. */
  lineWrapping?: boolean;
  /** When false, skip the shared file-view highlight style (caller supplies its own). */
  includeSyntaxHighlighting?: boolean;
  /** When false, omit the fold gutter (keeps line numbers only). */
  includeFoldGutter?: boolean;
  /**
   * When provided, use literal colors (baked from this theme) for the highlight
   * style and editor theme instead of `var(--df-*)` CSS custom properties.
   * Required when the editor is mounted inside an iframe (separate document),
   * since it cannot see the outer document's CSS variables.
   */
  solidColors?: ThemeColors;
}

const fileViewHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment, tags.meta],
    color: "var(--df-text-muted)",
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
    color: "var(--df-primary)",
  },
  {
    tag: [tags.operator, tags.definitionOperator, tags.punctuation, tags.separator],
    color: "var(--df-text-dimmed)",
  },
  {
    tag: [tags.string, tags.docString, tags.character, tags.attributeValue],
    color: "var(--df-success)",
  },
  {
    tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null, tags.atom],
    color: "var(--df-warning)",
  },
  {
    tag: [tags.regexp, tags.escape, tags.url],
    color: "var(--df-accent)",
  },
  {
    tag: [tags.className, tags.typeName, tags.namespace, tags.tagName],
    color: "color-mix(in srgb, var(--df-link) 72%, var(--df-success))",
  },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.definition(tags.variableName),
      tags.definition(tags.propertyName),
    ],
    color: "var(--df-link)",
  },
  {
    tag: [tags.propertyName, tags.attributeName, tags.labelName],
    color: "color-mix(in srgb, var(--df-link) 78%, var(--df-text))",
  },
  {
    tag: [tags.constant(tags.variableName), tags.standard(tags.variableName), tags.macroName],
    color: "color-mix(in srgb, var(--df-warning) 85%, var(--df-text))",
  },
  {
    tag: [tags.deleted, tags.invalid],
    color: "var(--df-danger)",
  },
  {
    tag: [tags.inserted, tags.changed],
    color: "var(--df-success)",
  },
  {
    tag: tags.heading,
    color: "var(--df-primary)",
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

/**
 * Literal-color highlight style for the file editor's opaque iframe surface.
 * Iframes are separate documents — `var(--df-*)` from the outer window never
 * resolves inside them, so this mirrors {@link fileViewHighlightStyle} with
 * baked-in {@link ThemeColors} values instead.
 */
export function buildFileViewSolidHighlightStyle(colors: ThemeColors) {
  const syn = colors.terminal;
  return HighlightStyle.define([
    {
      tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment, tags.meta],
      color: colors.textMuted,
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
      color: colors.primary,
    },
    {
      tag: [tags.operator, tags.definitionOperator, tags.punctuation, tags.separator],
      color: colors.textDimmed,
    },
    {
      tag: [tags.string, tags.docString, tags.character, tags.attributeValue],
      color: syn.green || colors.success,
    },
    {
      tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null, tags.atom],
      color: syn.yellow || colors.warning,
    },
    {
      tag: [tags.regexp, tags.escape, tags.url],
      color: syn.cyan || colors.accent,
    },
    {
      tag: [tags.className, tags.typeName, tags.namespace, tags.tagName],
      color: colors.link,
    },
    {
      tag: [
        tags.function(tags.variableName),
        tags.function(tags.propertyName),
        tags.definition(tags.variableName),
        tags.definition(tags.propertyName),
      ],
      color: colors.link,
    },
    {
      tag: [tags.propertyName, tags.attributeName, tags.labelName],
      color: colors.link,
    },
    {
      tag: [tags.constant(tags.variableName), tags.standard(tags.variableName), tags.macroName],
      color: colors.warning,
    },
    {
      tag: [tags.deleted, tags.invalid],
      color: colors.danger,
    },
    {
      tag: [tags.inserted, tags.changed],
      color: colors.success,
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

/**
 * Literal-color EditorView theme for the file editor's opaque iframe surface.
 * Structurally mirrors the `var(--df-*)`-based theme built inline in
 * {@link codeMirrorFileViewExtensions}, but every color is a baked-in hex/rgb
 * value (and the font-family is a literal stack) since iframes cannot see the
 * outer document's CSS custom properties.
 */
export function buildFileViewSolidTheme(colors: ThemeColors) {
  const selection =
    colors.terminal.selectionBackground || `color-mix(in srgb, ${colors.primary} 28%, transparent)`;
  const caret = colors.terminal.cursor || colors.text;
  return Prec.highest(
    EditorView.theme(
      {
      "&": {
        height: "100% !important",
        backgroundColor: `${colors.bg} !important`,
        color: `${colors.text} !important`,
      },
      "&.cm-focused": {
        outline: "none",
      },
      ".cm-content": {
        minHeight: "100%",
        caretColor: caret,
        cursor: "text",
        userSelect: "text",
        color: `${colors.text} !important`,
        // No opaque background here: CodeMirror's selection/cursor/active-line
        // decorations render as sibling `<div>` layers with *negative*
        // z-index (by design — see @codemirror/view's `drawSelection`), so
        // they paint *behind* `.cm-content`'s own box. An opaque background
        // on `.cm-content` itself would completely hide them. `.cm-scroller`
        // (below) already paints the same solid color one level up, so the
        // visible result is identical — this just keeps `.cm-content`
        // see-through so those layers show through it.
        backgroundColor: "transparent !important",
        tabSize: "4 !important",
        padding: `${FILE_VIEW_CONTENT_PADDING_Y} 0 !important`,
        lineHeight: "1.6 !important",
        flex: "1 0 auto !important",
        minWidth: "min-content !important",
        boxSizing: "border-box !important",
        outline: "none !important",
        border: "none !important",
      },
      ".cm-line": {
        cursor: "text",
        paddingLeft: `${FILE_VIEW_LINE_PADDING_X} !important`,
        paddingRight: `${FILE_VIEW_LINE_PADDING_X} !important`,
        boxSizing: "border-box !important",
        minWidth: "100% !important",
      },
      ".cm-tab": {
        tabSize: "4 !important",
        display: "inline-block !important",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: caret,
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: `${selection} !important`,
      },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
        backgroundColor: `color-mix(in srgb, ${colors.primary} 28%, transparent)`,
      },
      ".cm-scroller": {
        fontFamily: "ui-monospace, 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace",
        overflow: "auto !important",
        color: `${colors.text} !important`,
        backgroundColor: `${colors.bg} !important`,
        display: "flex !important",
        alignItems: "flex-start !important",
      },
      ".cm-gutters": {
        backgroundColor: `${colors.bgHover} !important`,
        color: `${colors.textMuted} !important`,
        borderRightColor: colors.border,
        // Sticky during horizontal scroll (long unwrapped lines).
        position: "sticky !important",
        left: "0 !important",
        alignSelf: "stretch !important",
        boxSizing: "border-box !important",
      },
      ".cm-gutter.cm-lineNumbers": {
        minWidth: `${FILE_VIEW_LINE_NUMBER_GUTTER_PX}px !important`,
        width: `${FILE_VIEW_LINE_NUMBER_GUTTER_PX}px !important`,
        maxWidth: `${FILE_VIEW_LINE_NUMBER_GUTTER_PX}px !important`,
        flex: `0 0 ${FILE_VIEW_LINE_NUMBER_GUTTER_PX}px !important`,
      },
      ".cm-lineNumbers .cm-gutterElement": {
        display: "flex !important",
        alignItems: "center !important",
        justifyContent: "flex-end !important",
        boxSizing: "border-box !important",
        padding: "0 10px 0 4px !important",
        minWidth: "1.25rem",
        width: "100% !important",
        textAlign: "right !important",
        fontSize: `${FILE_VIEW_LINE_NUMBER_FONT_PX}px !important`,
        lineHeight: "1.65 !important",
      },
      ".cm-gutter.cm-foldGutter": {
        width: `${FILE_VIEW_FOLD_GUTTER_PX}px !important`,
        minWidth: `${FILE_VIEW_FOLD_GUTTER_PX}px !important`,
        maxWidth: `${FILE_VIEW_FOLD_GUTTER_PX}px !important`,
        flex: `0 0 ${FILE_VIEW_FOLD_GUTTER_PX}px !important`,
      },
      ".cm-foldGutter": {
        width: "1.1rem",
      },
      ".cm-foldGutter span": {
        cursor: "pointer",
        color: colors.textMuted,
        opacity: "0.45",
        transition: "opacity 120ms ease, color 120ms ease",
      },
      ".cm-foldGutter:hover span": {
        opacity: "0.8",
      },
      ".cm-activeLine": {
        "&::before": {
          content: '""',
          position: "absolute",
          inset: "0",
          zIndex: "-3",
          backgroundColor: `color-mix(in srgb, ${colors.bgHover} 45%, transparent)`,
        },
        position: "relative",
        backgroundColor: "transparent",
      },
      ".cm-activeLineGutter": {
        backgroundColor: `color-mix(in srgb, ${colors.bgHover} 65%, transparent)`,
      },
      ".cm-tooltip": {
        borderColor: colors.border,
        backgroundColor: colors.bgPanel,
        color: colors.text,
        fontSize: "12px",
        boxShadow: "0 10px 30px rgb(0 0 0 / 0.22)",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: `color-mix(in srgb, ${colors.primary} 18%, transparent)`,
        color: colors.text,
      },
      ".cm-search": {
        backgroundColor: colors.bgPanel,
        color: colors.text,
        borderBottomColor: colors.border,
        gap: "0.375rem",
        padding: "0.375rem",
      },
      ".cm-search input": {
        backgroundColor: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        borderRadius: "0.25rem",
        padding: "0.125rem 0.375rem",
      },
      ".cm-search input::placeholder": {
        color: colors.textMuted,
      },
      ".cm-search input[type=checkbox]": {
        accentColor: colors.primary,
      },
      ".cm-search .cm-button": {
        backgroundColor: colors.bgHover,
        backgroundImage: "none",
        color: colors.text,
        border: `1px solid ${colors.border}`,
        borderRadius: "0.25rem",
        padding: "0.125rem 0.375rem",
      },
      ".cm-search .cm-button:hover": {
        backgroundColor: `color-mix(in srgb, ${colors.primary} 14%, ${colors.bgHover})`,
        borderColor: `color-mix(in srgb, ${colors.primary} 45%, ${colors.border})`,
      },
      ".cm-search .cm-button:active": {
        backgroundColor: `color-mix(in srgb, ${colors.primary} 22%, ${colors.bgHover})`,
        backgroundImage: "none",
      },
      ".cm-search input:focus-visible, .cm-search button:focus-visible": {
        outline: `2px solid ${colors.focusRing}`,
        outlineOffset: "1px",
      },
      ".cm-search button[name=close]": {
        color: colors.textMuted,
      },
      ".cm-search button[name=close]:hover": {
        color: colors.text,
      },
      },
      { dark: isDarkColor(colors.bg) },
    ),
  );
}

export function languageExtension(language: string) {
  switch (language) {
    case "batch":
    case "shell":
      return StreamLanguage.define(shell);
    case "c":
    case "cpp":
      return cpp();
    case "cmake":
      return StreamLanguage.define(cmake);
    case "csharp":
      return StreamLanguage.define(csharp);
    case "css":
    case "less":
      return css();
    case "dart":
      return StreamLanguage.define(dart);
    case "diff":
      return StreamLanguage.define(diff);
    case "dockerfile":
      return StreamLanguage.define(dockerFile);
    case "fsharp":
      return StreamLanguage.define(fSharp);
    case "go":
      return go();
    case "graphql":
      return javascript({ jsx: true, typescript: true });
    case "html":
      return html();
    case "ini":
    case "makefile":
    case "properties":
      return StreamLanguage.define(properties);
    case "java":
    case "kotlin":
      return java();
    case "javascript":
      return javascript({ jsx: true });
    case "json":
    case "json5":
    case "jsonc":
      return json();
    case "lua":
      return StreamLanguage.define(lua);
    case "markdown":
      return markdown();
    case "nginx":
      return StreamLanguage.define(nginx);
    case "perl":
      return StreamLanguage.define(perl);
    case "php":
      return php();
    case "powershell":
      return StreamLanguage.define(powerShell);
    case "protobuf":
      return StreamLanguage.define(protobuf);
    case "python":
      return python();
    case "r":
      return StreamLanguage.define(r);
    case "ruby":
      return StreamLanguage.define(ruby);
    case "rust":
      return rust();
    case "sass":
      return sassLanguage({ indented: true });
    case "scss":
      return sassLanguage();
    case "sql":
      return sql();
    case "svelte":
    case "vue":
      return html();
    case "swift":
      return StreamLanguage.define(swift);
    case "toml":
      return StreamLanguage.define(toml);
    case "typescript":
      return javascript({ jsx: true, typescript: true });
    case "vb":
      return StreamLanguage.define(vb);
    case "xml":
      return xml();
    case "yaml":
      return yaml();
    default:
      return [];
  }
}

export function getDisplayLanguage(language: string) {
  return language === "plaintext" ? "Plain Text" : language.toLocaleUpperCase();
}

export function getCursorPosition(state: EditorState): CursorPosition {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { line: line.number, column: head - line.from + 1 };
}

export function codeMirrorFileViewExtensions(
  language: string,
  {
    editable = true,
    updateListener,
    allowScrollPastEnd = true,
    lineWrapping = true,
    includeSyntaxHighlighting = true,
    includeFoldGutter = true,
    solidColors,
  }: FileViewExtensionOptions = {},
) {
  const scrollPastEndEnabled = solidColors ? false : allowScrollPastEnd;
  const extensions: Extension[] = [
    // Lets style-mod's StyleModule.mount tag CodeMirror's own dynamic
    // <style> elements with Tauri's per-load CSP nonce (see getCspNonce doc).
    EditorView.cspNonce.of(getCspNonce()),
    lineNumbers(),
    ...(includeFoldGutter ? [foldGutter()] : []),
    highlightSpecialChars(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    ...(includeSyntaxHighlighting
      ? [
          syntaxHighlighting(
            solidColors ? buildFileViewSolidHighlightStyle(solidColors) : fileViewHighlightStyle,
            solidColors ? { fallback: true } : undefined,
          ),
        ]
      : []),
    bracketMatching(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    search({ top: true }),
    languageExtension(language),
    rectangularSelection(),
    crosshairCursor(),
    ...(scrollPastEndEnabled ? [scrollPastEnd()] : []),
    keymap.of([...defaultKeymap, ...searchKeymap, ...(includeFoldGutter ? foldKeymap : [])]),
    ...(lineWrapping ? [EditorView.lineWrapping] : []),
    solidColors
      ? buildFileViewSolidTheme(solidColors)
      : EditorView.theme({
          "&": {
            height: "100%",
            backgroundColor: "var(--background)",
            color: "var(--foreground)",
          },
          "&.cm-focused": {
            outline: "none",
          },
          ".cm-content": {
            minHeight: "100%",
            caretColor: "var(--foreground)",
            cursor: "text",
            userSelect: "text",
          },
          ".cm-line": {
            cursor: "text",
          },
          ".cm-cursor, .cm-dropCursor": {
            borderLeftColor: "var(--foreground)",
          },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
            backgroundColor: "var(--df-terminal-selection, var(--df-primary)) !important",
          },
          "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
            backgroundColor: "color-mix(in srgb, var(--primary) 28%, transparent)",
          },
          ".cm-scroller": {
            fontFamily: "var(--font-mono), 'JetBrains Mono', monospace",
            overflow: "auto",
          },
          ".cm-gutters": {
            backgroundColor: "color-mix(in srgb, var(--muted) 18%, transparent)",
            color: "var(--muted-foreground)",
            borderRightColor: "color-mix(in srgb, var(--border) 70%, transparent)",
          },
          ".cm-foldGutter": {
            width: "1.1rem",
          },
          ".cm-foldGutter span": {
            cursor: "pointer",
            color: "var(--muted-foreground)",
            opacity: "0.45",
            transition: "opacity 120ms ease, color 120ms ease",
          },
          ".cm-foldGutter:hover span": {
            opacity: "0.8",
          },
          ".cm-activeLine": {
            "&::before": {
              content: '""',
              position: "absolute",
              inset: "0",
              zIndex: "-3",
              backgroundColor: "color-mix(in srgb, var(--muted) 22%, transparent)",
            },
            position: "relative",
            backgroundColor: "transparent",
          },
          ".cm-activeLineGutter": {
            backgroundColor: "color-mix(in srgb, var(--muted) 32%, transparent)",
          },
          ".cm-tooltip": {
            borderColor: "var(--border)",
            backgroundColor: "var(--popover)",
            color: "var(--popover-foreground)",
            fontSize: "12px",
            boxShadow: "0 10px 30px rgb(0 0 0 / 0.22)",
          },
          ".cm-tooltip-autocomplete ul li[aria-selected]": {
            backgroundColor: "color-mix(in srgb, var(--primary) 18%, transparent)",
            color: "var(--foreground)",
          },
          ".cm-search": {
            backgroundColor: "var(--popover)",
            color: "var(--popover-foreground)",
            borderBottomColor: "var(--border)",
            gap: "0.375rem",
            padding: "0.375rem",
          },
          ".cm-search input": {
            backgroundColor: "var(--background)",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
            borderRadius: "0.25rem",
            padding: "0.125rem 0.375rem",
          },
          ".cm-search input::placeholder": {
            color: "var(--muted-foreground)",
          },
          ".cm-search input[type=checkbox]": {
            accentColor: "var(--primary)",
          },
          ".cm-search .cm-button": {
            backgroundColor: "var(--secondary)",
            backgroundImage: "none",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
            borderRadius: "0.25rem",
            padding: "0.125rem 0.375rem",
          },
          ".cm-search .cm-button:hover": {
            backgroundColor: "color-mix(in srgb, var(--primary) 14%, var(--secondary))",
            borderColor: "color-mix(in srgb, var(--primary) 45%, var(--border))",
          },
          ".cm-search .cm-button:active": {
            backgroundColor: "color-mix(in srgb, var(--primary) 22%, var(--secondary))",
            backgroundImage: "none",
          },
          ".cm-search input:focus-visible, .cm-search button:focus-visible": {
            outline: "2px solid var(--ring)",
            outlineOffset: "1px",
          },
          ".cm-search button[name=close]": {
            color: "var(--muted-foreground)",
          },
          ".cm-search button[name=close]:hover": {
            color: "var(--foreground)",
          },
        }),
  ];

  if (editable) {
    extensions.splice(
      3,
      0,
      history(),
      indentOnInput(),
      autocompletion(),
      closeBrackets(),
      keymap.of([
        { key: "Tab", run: insertTab },
        { key: "Shift-Tab", run: indentLess },
      ]),
      keymap.of([...closeBracketsKeymap, ...historyKeymap, ...completionKeymap]),
    );
  } else {
    extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
  }

  if (updateListener) {
    extensions.push(updateListener);
  }

  return extensions;
}
