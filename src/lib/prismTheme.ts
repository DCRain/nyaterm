import type { CSSProperties } from "react";
import type { NoteColors, TerminalColors, ThemeColors } from "@/lib/themes";

/** Persisted sentinel: note theme follows the UI theme. `null` follows the terminal theme. */
export const NOTE_THEME_FOLLOW_UI = "__ui__";

/** Build a Prism style map from a syntax / terminal palette. */
export function buildPrismThemeFromSyntax(syntax: TerminalColors): Record<string, CSSProperties> {
  return {
    'code[class*="language-"]': {
      color: syntax.foreground,
      background: "none",
      fontFamily: "inherit",
      textAlign: "left",
      whiteSpace: "pre",
      wordSpacing: "normal",
      wordBreak: "normal",
      wordWrap: "normal",
      lineHeight: "1.5",
      tabSize: 4,
    },
    'pre[class*="language-"]': {
      color: syntax.foreground,
      background: "transparent",
      fontFamily: "inherit",
      textAlign: "left",
      whiteSpace: "pre",
      wordSpacing: "normal",
      wordBreak: "normal",
      wordWrap: "normal",
      lineHeight: "1.5",
      tabSize: 4,
      overflow: "auto",
    },
    comment: { color: syntax.brightBlack, fontStyle: "italic" },
    prolog: { color: syntax.brightBlack },
    doctype: { color: syntax.brightBlack },
    cdata: { color: syntax.brightBlack },
    punctuation: { color: syntax.foreground },
    property: { color: syntax.cyan },
    tag: { color: syntax.red },
    boolean: { color: syntax.magenta },
    number: { color: syntax.magenta },
    constant: { color: syntax.magenta },
    symbol: { color: syntax.green },
    deleted: { color: syntax.red },
    selector: { color: syntax.green },
    "attr-name": { color: syntax.yellow },
    string: { color: syntax.green },
    char: { color: syntax.green },
    builtin: { color: syntax.cyan },
    inserted: { color: syntax.green },
    operator: { color: syntax.foreground },
    entity: { color: syntax.yellow, cursor: "help" },
    url: { color: syntax.cyan },
    variable: { color: syntax.red },
    atrule: { color: syntax.yellow },
    "attr-value": { color: syntax.green },
    function: { color: syntax.blue },
    "class-name": { color: syntax.yellow },
    keyword: { color: syntax.magenta },
    regex: { color: syntax.cyan },
    important: { color: syntax.yellow, fontWeight: "bold" },
    bold: { fontWeight: "bold" },
    italic: { fontStyle: "italic" },
    namespace: { opacity: 0.7 },
  };
}

/** Build a Prism style map from theme terminal palette (AI helpers). */
export function buildPrismThemeFromColors(colors: ThemeColors): Record<string, CSSProperties> {
  return buildPrismThemeFromSyntax(colors.terminal);
}

/** Build Prism styles from the note palette. */
export function buildPrismThemeFromNoteColors(notes: NoteColors): Record<string, CSSProperties> {
  return buildPrismThemeFromSyntax(notes.syntax);
}

/** Scope `--df-*` theme tokens onto a subtree (e.g. note editor). */
export function themeColorsToCssVars(colors: ThemeColors): CSSProperties {
  return {
    "--df-bg": colors.bg,
    "--df-bg-panel": colors.bgPanel,
    "--df-bg-panel-solid": colors.bgPanel,
    "--df-bg-terminal": colors.bgTerminal,
    "--df-bg-hover": colors.bgHover,
    "--df-bg-hover-solid": colors.bgHover,
    "--df-bg-input": colors.bgInput,
    "--df-bg-section-header": colors.bgSectionHeader,
    "--df-border": colors.border,
    "--df-text": colors.text,
    "--df-text-muted": colors.textMuted,
    "--df-text-dimmed": colors.textDimmed,
    "--df-text-solid": colors.text,
    "--df-text-muted-solid": colors.textMuted,
    "--df-text-dimmed-solid": colors.textDimmed,
    "--df-primary": colors.primary,
    "--df-primary-hover": colors.primaryHover,
    "--df-on-primary": colors.onPrimary,
    "--df-focus-ring": colors.focusRing,
    "--df-danger": colors.danger,
    "--df-danger-hover": colors.dangerHover,
    "--df-success": colors.success,
    "--df-warning": colors.warning,
    "--df-link": colors.link,
    "--df-shadow": colors.shadow,
    "--df-scroll-thumb": colors.scrollThumb,
    "--df-accent": colors.accent,
    "--df-terminal-bg": colors.terminal.background,
    "--df-terminal-fg": colors.terminal.foreground,
  } as CSSProperties;
}

/** Scope note palette tokens onto the note editor subtree. */
export function noteColorsToCssVars(notes: NoteColors): CSSProperties {
  return {
    "--df-bg": notes.bg,
    "--df-bg-panel": notes.bgPanel,
    "--df-bg-panel-solid": notes.bgPanel,
    "--df-bg-terminal": notes.syntax.background,
    "--df-bg-hover": notes.bgHover,
    "--df-bg-hover-solid": notes.bgHover,
    "--df-bg-input": notes.bgPanel,
    "--df-bg-section-header": notes.bgHover,
    "--df-border": notes.border,
    "--df-text": notes.text,
    "--df-text-muted": notes.textMuted,
    "--df-text-dimmed": notes.textMuted,
    "--df-text-solid": notes.text,
    "--df-text-muted-solid": notes.textMuted,
    "--df-text-dimmed-solid": notes.textMuted,
    "--df-primary": notes.primary,
    "--df-primary-hover": notes.primary,
    "--df-on-primary": notes.bgPanel,
    "--df-focus-ring": notes.primary,
    "--df-danger": notes.danger,
    "--df-danger-hover": notes.danger,
    "--df-link": notes.link,
    "--df-selection": notes.selectionBackground,
    "--df-caret": notes.syntax.cursor || notes.text,
    // Higher-contrast region lines (plain --df-border often blends with bgPanel).
    "--df-divider": `color-mix(in srgb, ${notes.text} 14%, transparent)`,
    "--df-terminal-bg": notes.syntax.background,
    "--df-terminal-fg": notes.syntax.foreground,
    // So CodeMirror themes that use --foreground/--background follow the note palette.
    "--foreground": notes.text,
    "--background": notes.bgPanel,
  } as CSSProperties;
}
