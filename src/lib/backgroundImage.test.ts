import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppearanceSettings } from "@/types/global";
import { themes } from "./themes";
import { resolveTheme } from "./themes";

vi.mock("./invoke", () => ({ invoke: vi.fn() }));
vi.mock("./logger", () => ({
  logger: {
    warn: vi.fn(),
  },
}));
vi.mock("./platform", () => ({
  isWindows: true,
  isMacOS: false,
  isLinux: false,
}));

const themeColors = resolveTheme("github-dark").colors;

function appearance(partial: Partial<AppearanceSettings> = {}): AppearanceSettings {
  return {
    theme: "github-dark",
    custom_themes: [],
    font_family: "JetBrains Mono",
    ui_font_family: "Inter",
    font_size: 14,
    font_weight: 400,
    font_weight_bold: 700,
    background_opacity: 1,
    background_image_path: null,
    background_image_fit: "cover",
    background_image_opacity: 0.45,
    cursor_style: "block",
    cursor_blink: true,
    ui_font_size: 13,
    terminal_theme: null,
    note_theme: null,
    minimum_contrast_ratio: 1,
    panel_multi_open: false,
    window_transparency: "transparent",
    window_transparency_tint: 1,
    window_transparency_blur: false,
    ...partial,
  };
}

function setNavigator(userAgent: string, platform = "") {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: platform,
  });
}

async function importBackgroundImage() {
  vi.resetModules();
  return import("./backgroundImage");
}

describe("buildSurfaceCssVariables window transparency", () => {
  it("uses one tint for chrome and terminal like Windows Terminal", async () => {
    const { buildSurfaceCssVariables } = await importBackgroundImage();
    const colors = themes["github-dark"].colors;
    const vars = buildSurfaceCssVariables(
      colors,
      appearance({
        window_transparency_tint: 0.55,
        window_transparency: "transparent",
        window_transparency_blur: true,
      }),
    );

    expect(vars["--df-bg"]).toBe("rgba(13, 17, 23, 0.55)");
    expect(vars["--df-bg-panel"]).toBe("rgba(22, 27, 34, 0.55)");
    expect(vars["--df-bg-terminal"]).toBe("rgba(13, 17, 23, 0.55)");
    expect(vars["--df-text"]).toBeUndefined();
    expect(vars["--df-text-solid"]).toBe(colors.text);
    expect(vars["--df-bg-panel-solid"]).toBe(colors.bgPanel);
  });

  it("keeps opaque theme surfaces when transparency is off", async () => {
    const { buildSurfaceCssVariables } = await importBackgroundImage();
    const colors = themes["github-dark"].colors;
    const vars = buildSurfaceCssVariables(
      colors,
      appearance({ window_transparency_tint: 1, window_transparency: "none" }),
    );

    expect(vars["--df-bg"]).toBe(colors.bg);
    expect(vars["--df-bg-terminal"]).toBe(colors.bgTerminal);
    expect(vars["--df-text-solid"]).toBe(colors.text);
  });
});

describe("terminal surface background variables", () => {
  beforeEach(() => {
    setNavigator("Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64");
  });

  it("keeps the terminal surface pointed at the terminal theme background in normal mode", async () => {
    const { buildSurfaceCssVariables, buildTerminalThemeColors } = await importBackgroundImage();
    const cssVars = buildSurfaceCssVariables(themeColors, appearance({ window_transparency: "none" }));
    const terminalColors = buildTerminalThemeColors(themeColors.terminal, appearance({ window_transparency: "none" }));

    expect(cssVars["--df-bg-terminal"]).toBe(themeColors.bgTerminal);
    expect(cssVars["--df-terminal-surface-bg"]).toBe(
      "var(--df-terminal-bg, var(--df-bg-terminal))",
    );
    expect(terminalColors.background).toBe(themeColors.terminal.background);
  });

  it("keeps background-image transparency for xterm and terminal wrappers", async () => {
    const { buildSurfaceCssVariables, buildTerminalThemeColors } = await importBackgroundImage();
    const withWallpaper = appearance({
      background_image_path: "C:\\wallpapers\\terminal.png",
      background_opacity: 0.5,
      window_transparency: "none",
    });

    const cssVars = buildSurfaceCssVariables(themeColors, withWallpaper);
    const terminalColors = buildTerminalThemeColors(themeColors.terminal, withWallpaper);

    expect(cssVars["--df-bg-terminal"]).toBe("rgba(13, 17, 23, 0.5)");
    expect(cssVars["--df-terminal-surface-bg"]).toBe("transparent");
    expect(terminalColors.background).toBe("rgba(0, 0, 0, 0)");
  });

  it("keeps terminal wrappers transparent while the UI terminal surface provides Windows tint", async () => {
    setNavigator("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32");
    const { buildSurfaceCssVariables, buildTerminalThemeColors } = await importBackgroundImage();
    const transparentWindow = appearance({
      window_transparency: "transparent",
      window_transparency_tint: 0.6,
    });

    const cssVars = buildSurfaceCssVariables(themeColors, transparentWindow);
    const terminalColors = buildTerminalThemeColors(themeColors.terminal, transparentWindow);

    expect(cssVars["--df-bg-terminal"]).toBe("rgba(13, 17, 23, 0.6)");
    expect(cssVars["--df-terminal-surface-bg"]).toBe("transparent");
    expect(terminalColors.background).toBe("rgba(0, 0, 0, 0)");
  });

  it("preserves custom terminal theme colors while Windows transparency owns the wrapper background", async () => {
    setNavigator("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32");
    const { buildSurfaceCssVariables, buildTerminalThemeColors } = await importBackgroundImage();
    const customTerminalColors = {
      ...themeColors.terminal,
      background: "#123456",
      foreground: "#abcdef",
      red: "#ff0000",
    };
    const transparentWindow = appearance({
      terminal_theme: "custom-terminal",
      window_transparency: "transparent",
      window_transparency_tint: 0.6,
    });

    const cssVars = buildSurfaceCssVariables(themeColors, transparentWindow);
    const terminalColors = buildTerminalThemeColors(customTerminalColors, transparentWindow);

    expect(cssVars["--df-terminal-surface-bg"]).toBe("transparent");
    expect(terminalColors.background).toBe("rgba(0, 0, 0, 0)");
    expect(terminalColors.foreground).toBe("#abcdef");
    expect(terminalColors.red).toBe("#ff0000");
  });
});
