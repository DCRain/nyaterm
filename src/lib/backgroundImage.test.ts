import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppearanceSettings } from "@/types/global";
import { resolveTheme } from "./themes";

vi.mock("./invoke", () => ({ invoke: vi.fn() }));
vi.mock("./logger", () => ({
  logger: {
    warn: vi.fn(),
  },
}));

const themeColors = resolveTheme("github-dark").colors;

function appearance(overrides: Partial<AppearanceSettings> = {}): AppearanceSettings {
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
    ui_font_size: 16,
    terminal_theme: null,
    minimum_contrast_ratio: 1,
    panel_multi_open: false,
    window_transparency: "none",
    window_transparency_tint: 1,
    window_transparency_blur: false,
    ...overrides,
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

describe("terminal surface background variables", () => {
  beforeEach(() => {
    setNavigator("Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64");
  });

  it("keeps the terminal surface pointed at the terminal theme background in normal mode", async () => {
    const { buildSurfaceCssVariables, buildTerminalThemeColors } = await importBackgroundImage();
    const cssVars = buildSurfaceCssVariables(themeColors, appearance());
    const terminalColors = buildTerminalThemeColors(themeColors.terminal, appearance());

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
