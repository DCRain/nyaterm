import type { CSSProperties } from "react";
import type { AppearanceSettings, BackgroundImageFit } from "@/types/global";
import { invoke } from "./invoke";
import { logger } from "./logger";
import { isWindows } from "./platform";
import type { TerminalColors, ThemeColors } from "./themes";

export const BACKGROUND_IMAGE_FITS = ["cover", "contain", "stretch", "tile"] as const;
export const DEFAULT_BACKGROUND_IMAGE_FIT: BackgroundImageFit = "cover";
export const DEFAULT_BACKGROUND_IMAGE_OPACITY = 0.45;
export const DEFAULT_BACKGROUND_CONTENT_OPACITY = 0.78;
export const DEFAULT_WINDOW_TRANSPARENCY_OPACITY = 1;

type CssVars = CSSProperties & Record<`--${string}`, string>;

export function clampOpacity(value: number | null | undefined, fallback = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export function normalizeBackgroundImageFit(value: string | null | undefined): BackgroundImageFit {
  return BACKGROUND_IMAGE_FITS.includes(value as BackgroundImageFit)
    ? (value as BackgroundImageFit)
    : DEFAULT_BACKGROUND_IMAGE_FIT;
}

export function isBackgroundImageEnabled(
  appearance: Pick<AppearanceSettings, "background_image_path">,
) {
  return Boolean(appearance.background_image_path?.trim());
}

export function isTerminalTransparencyEnabled(
  appearance: Pick<
    AppearanceSettings,
    "background_image_path" | "window_transparency" | "window_transparency_tint"
  >,
) {
  return isBackgroundImageEnabled(appearance) || isWindowTransparencyEnabled(appearance);
}

export function getWindowTransparencyOpacity(
  appearance: Pick<AppearanceSettings, "window_transparency" | "window_transparency_tint">,
) {
  return clampOpacity(appearance.window_transparency_tint, DEFAULT_WINDOW_TRANSPARENCY_OPACITY);
}

export function windowTransparencyModeForOpacity(opacity: number): "none" | "transparent" {
  return clampOpacity(opacity, DEFAULT_WINDOW_TRANSPARENCY_OPACITY) >= 1 ? "none" : "transparent";
}

/** Native window transparency makes the window show through to the desktop.
 * Requires translucent webview surface colors. */
export function isWindowTransparencyEnabled(
  appearance: Pick<AppearanceSettings, "window_transparency" | "window_transparency_tint">,
) {
  return isWindows && getWindowTransparencyOpacity(appearance) < 1;
}

function quoteCssUrl(url: string) {
  return `url("${url.replace(/["\\]/g, "\\$&")}")`;
}

/**
 * Load a background image file via a Rust command and return a data URL.
 * Returns empty string if the path is empty or the file cannot be read.
 */
export async function loadBackgroundImageDataUrl(path: string | null | undefined): Promise<string> {
  const trimmed = path?.trim();
  if (!trimmed) return "";
  try {
    return await invoke<string>("read_background_image_data_url", { path: trimmed });
  } catch (error) {
    logger.warn({
      domain: "background-image",
      event: "load_data_url_failed",
      message: `Failed to load background image: ${trimmed}`,
      error,
    });
    return "";
  }
}

export function getBackgroundFitStyle(fit: string | null | undefined): CSSProperties {
  switch (normalizeBackgroundImageFit(fit)) {
    case "contain":
      return {
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundSize: "contain",
      };
    case "stretch":
      return {
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundSize: "100% 100%",
      };
    case "tile":
      return {
        backgroundPosition: "top left",
        backgroundRepeat: "repeat",
        backgroundSize: "auto",
      };
    default:
      return {
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundSize: "cover",
      };
  }
}

export function buildBackgroundImageLayerStyle(
  appearance: AppearanceSettings,
  dataUrl: string,
): CSSProperties {
  if (!dataUrl) {
    return { display: "none" };
  }

  return {
    backgroundImage: quoteCssUrl(dataUrl),
    opacity: clampOpacity(appearance.background_image_opacity, DEFAULT_BACKGROUND_IMAGE_OPACITY),
    ...getBackgroundFitStyle(appearance.background_image_fit),
  };
}

function colorWithAlpha(color: string, opacity: number) {
  if (opacity >= 1) return color;

  const hex = color.trim();
  const shortHex = /^#([\da-f])([\da-f])([\da-f])$/i.exec(hex);
  if (shortHex) {
    const [, r, g, b] = shortHex;
    return `rgba(${Number.parseInt(`${r}${r}`, 16)}, ${Number.parseInt(`${g}${g}`, 16)}, ${Number.parseInt(`${b}${b}`, 16)}, ${opacity})`;
  }

  const longHex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (longHex) {
    const [, r, g, b] = longHex;
    return `rgba(${Number.parseInt(r, 16)}, ${Number.parseInt(g, 16)}, ${Number.parseInt(b, 16)}, ${opacity})`;
  }

  return `color-mix(in srgb, ${color} ${Math.round(opacity * 100)}%, transparent)`;
}

/** Soften opaque theme borders so they don't slice translucent / acrylic surfaces. */
function softBorderColor(border: string, surfaceOpacity: number) {
  if (surfaceOpacity >= 0.98) return border;
  // Keep borders subtler than fills; opaque 1px lines look harsh on glass.
  const borderOpacity = Math.min(0.42, Math.max(0.18, surfaceOpacity * 0.5));
  return colorWithAlpha(border, borderOpacity);
}

function solidTextBackupCssVariables(colors: ThemeColors): CssVars {
  return {
    "--df-text-solid": colors.text,
    "--df-text-muted-solid": colors.textMuted,
    "--df-text-dimmed-solid": colors.textDimmed,
  };
}

export function buildSurfaceCssVariables(
  colors: ThemeColors,
  appearance: AppearanceSettings,
): CssVars {
  // Windows Terminal model: one opacity for the whole window over native
  // acrylic/blur. Chrome, terminal, and portaled overlays share the same tint.
  if (isWindowTransparencyEnabled(appearance)) {
    const surfaceOpacity = getWindowTransparencyOpacity(appearance);
    const bg = colorWithAlpha(colors.bg, surfaceOpacity);
    const bgPanel = colorWithAlpha(colors.bgPanel, surfaceOpacity);
    const bgTerminal = colorWithAlpha(colors.bgTerminal, surfaceOpacity);
    const bgHover = colorWithAlpha(colors.bgHover, surfaceOpacity);
    const bgInput = colorWithAlpha(colors.bgInput, surfaceOpacity);
    const bgSectionHeader = colorWithAlpha(colors.bgSectionHeader, surfaceOpacity);
    const border = softBorderColor(colors.border, surfaceOpacity);
    return {
      "--df-bg": bg,
      "--df-bg-panel": bgPanel,
      "--df-bg-panel-solid": colors.bgPanel,
      "--df-bg-terminal": bgTerminal,
      "--df-bg-hover": bgHover,
      "--df-bg-hover-solid": colors.bgHover,
      "--df-bg-input": bgInput,
      "--df-bg-section-header": bgSectionHeader,
      "--df-border": border,
      "--background": bg,
      "--card": bgPanel,
      "--popover": bgPanel,
      "--secondary": bgHover,
      "--muted": bgHover,
      "--accent": bgHover,
      "--border": border,
      "--input": border,
      ...solidTextBackupCssVariables(colors),
    };
  }
  const surfaceOpacity = isBackgroundImageEnabled(appearance)
    ? clampOpacity(appearance.background_opacity)
    : 1;
  const bg = colorWithAlpha(colors.bg, surfaceOpacity);
  const bgPanel = colorWithAlpha(colors.bgPanel, surfaceOpacity);
  const bgTerminal = colorWithAlpha(colors.bgTerminal, surfaceOpacity);
  const bgHover = colorWithAlpha(colors.bgHover, surfaceOpacity);
  const bgInput = colorWithAlpha(colors.bgInput, surfaceOpacity);
  const bgSectionHeader = colorWithAlpha(colors.bgSectionHeader, surfaceOpacity);
  const border = softBorderColor(colors.border, surfaceOpacity);

  return {
    "--df-bg": bg,
    "--df-bg-panel": bgPanel,
    "--df-bg-panel-solid": colors.bgPanel,
    "--df-bg-terminal": bgTerminal,
    "--df-bg-hover": bgHover,
    "--df-bg-hover-solid": colors.bgHover,
    "--df-bg-input": bgInput,
    "--df-bg-section-header": bgSectionHeader,
    "--df-border": border,
    "--background": bg,
    "--card": bgPanel,
    "--popover": bgPanel,
    "--secondary": bgHover,
    "--muted": bgHover,
    "--accent": bgHover,
    "--border": border,
    "--input": border,
    ...solidTextBackupCssVariables(colors),
  };
}

export function buildTerminalThemeColors(
  terminalColors: TerminalColors,
  appearance: AppearanceSettings,
): TerminalColors {
  if (!isTerminalTransparencyEnabled(appearance)) {
    return terminalColors;
  }

  return {
    ...terminalColors,
    background: "rgba(0, 0, 0, 0)",
  };
}
