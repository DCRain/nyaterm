import { describe, expect, it } from "vitest";
import { deriveNoteColors, themeList } from "./themes";

describe("note theme palettes", () => {
  it("derives a complete notes palette for every built-in theme", () => {
    for (const theme of themeList) {
      const { notes, terminal } = theme.colors;
      expect(notes.bgPanel, theme.id).toBe(terminal.background);
      expect(notes.text, theme.id).toBe(terminal.foreground);
      expect(notes.selectionBackground, theme.id).toBeTruthy();
      expect(notes.syntax.background, theme.id).not.toBe(notes.bgPanel);
      expect(notes.syntax.foreground, theme.id).toBe(terminal.foreground);
    }
  });

  it("boosts low-contrast selections against the writing surface", () => {
    const notes = deriveNoteColors({
      bg: "#fafafa",
      bgPanel: "#ececec",
      bgTerminal: "#fafafa",
      bgHover: "#dedfe3",
      bgInput: "#f4f4f5",
      bgSectionHeader: "#eeeeef",
      border: "#c5c6cc",
      text: "#383a42",
      textMuted: "#696c77",
      textDimmed: "#7f848e",
      primary: "#4078f2",
      primaryHover: "#2f65de",
      onPrimary: "#ffffff",
      focusRing: "#4078f2",
      danger: "#ca1243",
      dangerHover: "#a90935",
      success: "#50a14f",
      warning: "#c18401",
      link: "#4078f2",
      shadow: "rgb(56 58 66 / 0.15)",
      scrollThumb: "#b8bac1",
      accent: "#a626a4",
      terminal: {
        background: "#fafafa",
        foreground: "#383a42",
        cursor: "#526eff",
        selectionBackground: "#dfe3ea",
        lineHighlight: "#f1f1f2",
        findMatchBackground: "rgba(193, 132, 1, 0.2)",
        findMatchBorder: "#c18401",
        black: "#383a42",
        red: "#b74137",
        green: "#367d35",
        yellow: "#8d5c00",
        blue: "#2f65de",
        magenta: "#a626a4",
        cyan: "#0184bc",
        white: "#696c77",
        brightBlack: "#696c77",
        brightRed: "#b74137",
        brightGreen: "#367d35",
        brightYellow: "#8d5c00",
        brightBlue: "#2f65de",
        brightMagenta: "#8f1f8d",
        brightCyan: "#006f9e",
        brightWhite: "#383a42",
      },
    });

    expect(notes.bgPanel).toBe("#fafafa");
    expect(notes.selectionBackground.toLowerCase()).not.toBe("#dfe3ea");
    expect(notes.syntax.background).toBe("#f1f1f2");
  });
});
