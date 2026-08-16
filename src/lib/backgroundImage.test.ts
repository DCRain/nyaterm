import { describe, expect, it, vi } from "vitest";
import type { AppearanceSettings } from "@/types/global";
import { buildSurfaceCssVariables } from "./backgroundImage";
import { themes } from "./themes";

vi.mock("./platform", () => ({
  isWindows: true,
  isMacOS: false,
  isLinux: false,
}));

function appearance(partial: Partial<AppearanceSettings>): AppearanceSettings {
  return {
    theme: "github-dark",
    custom_themes: [],
    font_family: "monospace",
    ui_font_family: "sans-serif",
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

describe("buildSurfaceCssVariables window transparency", () => {
  it("uses one tint for chrome and terminal like Windows Terminal", () => {
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

  it("keeps opaque theme surfaces when transparency is off", () => {
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
