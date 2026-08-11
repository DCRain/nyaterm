import { useEffect } from "react";
import { applyThemeToDOM } from "@/context/ThemeContext";
import type { AppearanceSettings } from "@/types/global";
import { buildSurfaceCssVariables, isWindowTransparencyEnabled } from "./backgroundImage";
import type { ThemeColors } from "./themes";

/** Push glass surface tokens to :root so portaled overlays inherit them. */
export function syncWindowTransparencyDom(
  colors: ThemeColors,
  appearance: AppearanceSettings,
): () => void {
  const enabled = isWindowTransparencyEnabled(appearance);
  const blurEnabled = enabled && Boolean(appearance.window_transparency_blur);
  const vars = buildSurfaceCssVariables(colors, appearance);
  const root = document.documentElement;

  for (const el of [root, document.body]) {
    if (enabled) {
      el.dataset.windowTransparency = "true";
    } else {
      delete el.dataset.windowTransparency;
    }
    if (blurEnabled) {
      el.dataset.windowTransparencyBlur = "true";
    } else {
      delete el.dataset.windowTransparencyBlur;
    }
  }

  if (enabled) {
    for (const [key, value] of Object.entries(vars)) {
      if (typeof value === "string") {
        root.style.setProperty(key, value);
      }
    }
  } else {
    for (const key of Object.keys(vars)) {
      root.style.removeProperty(key);
    }
    applyThemeToDOM(colors);
  }

  return () => {
    for (const el of [root, document.body]) {
      delete el.dataset.windowTransparency;
      delete el.dataset.windowTransparencyBlur;
    }
    for (const key of Object.keys(vars)) {
      root.style.removeProperty(key);
    }
    applyThemeToDOM(colors);
  };
}

/** Keep html/body + :root CSS vars in sync with window transparency settings. */
export function useWindowTransparencyDom(colors: ThemeColors, appearance: AppearanceSettings) {
  useEffect(() => syncWindowTransparencyDom(colors, appearance), [appearance, colors]);
}
