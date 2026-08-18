import { sanitizeInlineStyle } from "@/lib/markdownHtmlSchema";

/** CSS property keys managed by the note toolbar. */
export type InlineTextStyleKey = "color" | "backgroundColor" | "fontSize";

export type InlineTextStylePatch = {
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
};

/** Preset font sizes available from the toolbar. */
export const INLINE_FONT_SIZE_PRESETS = ["12px", "14px", "16px", "18px", "20px", "24px"] as const;

export type InlineFontSizePreset = (typeof INLINE_FONT_SIZE_PRESETS)[number];

const CSS_PROPERTY_BY_KEY: Record<InlineTextStyleKey, string> = {
  color: "color",
  backgroundColor: "background-color",
  fontSize: "font-size",
};

const KEY_BY_CSS_PROPERTY: Record<string, InlineTextStyleKey> = {
  color: "color",
  "background-color": "backgroundColor",
  "font-size": "fontSize",
};

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR_RE =
  /^rgba?\(\s*\d{1,3}\s*(,\s*\d{1,3}\s*){2}(,\s*(0|1|0?\.\d+)\s*)?\)$/i;
const NAMED_COLOR_RE =
  /^(transparent|currentcolor|black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|cyan|magenta|lime|navy|teal|olive|maroon|silver|aqua|fuchsia)$/i;
const FONT_SIZE_PRESET_SET = new Set<string>(INLINE_FONT_SIZE_PRESETS);

const UNSAFE_VALUE_RE =
  /url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:|binding\s*:|-moz-binding|[;<>{}\\]/i;

/** Normalize and validate a color value for toolbar writes. */
export function normalizeInlineColor(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || UNSAFE_VALUE_RE.test(trimmed)) return undefined;
  if (HEX_COLOR_RE.test(trimmed)) return trimmed.toLowerCase();
  if (RGB_COLOR_RE.test(trimmed)) return trimmed.replace(/\s+/g, " ");
  if (NAMED_COLOR_RE.test(trimmed)) return trimmed.toLowerCase();
  return undefined;
}

/** Normalize and validate a font-size value (preset list only). */
export function normalizeInlineFontSize(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (!FONT_SIZE_PRESET_SET.has(trimmed)) return undefined;
  return trimmed;
}

/** Parse a CSS style attribute into a property map. */
export function parseStyleDeclarations(style: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const declaration of style.split(";")) {
    const trimmed = declaration.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const property = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    if (!property || !value) continue;
    result[property] = value;
  }
  return result;
}

/** Serialize a property map to a CSS style attribute (sanitized). */
export function serializeStyleDeclarations(map: Record<string, string>): string | undefined {
  const parts: string[] = [];
  for (const [property, value] of Object.entries(map)) {
    if (!property || !value) continue;
    parts.push(`${property}: ${value}`);
  }
  if (parts.length === 0) return undefined;
  return sanitizeInlineStyle(parts.join("; "));
}

/** Convert a toolbar patch into CSS property/value pairs (validated). */
export function patchToCssMap(patch: InlineTextStylePatch): Record<string, string> {
  const map: Record<string, string> = {};
  if (patch.color !== undefined) {
    const color = normalizeInlineColor(patch.color);
    if (color) map.color = color;
  }
  if (patch.backgroundColor !== undefined) {
    const background = normalizeInlineColor(patch.backgroundColor);
    if (background) map["background-color"] = background;
  }
  if (patch.fontSize !== undefined) {
    const fontSize = normalizeInlineFontSize(patch.fontSize);
    if (fontSize) map["font-size"] = fontSize;
  }
  return map;
}

/** Merge a validated patch into an existing style attribute string. */
export function mergeInlineStyle(
  existing: string | undefined,
  patch: InlineTextStylePatch,
): string | undefined {
  const map = existing ? parseStyleDeclarations(existing) : {};
  Object.assign(map, patchToCssMap(patch));
  return serializeStyleDeclarations(map);
}

/** Remove selected keys from a style attribute. */
export function removeInlineStyleKeys(
  existing: string | undefined,
  keys: InlineTextStyleKey[],
): string | undefined {
  if (!existing) return undefined;
  const map = parseStyleDeclarations(existing);
  for (const key of keys) {
    delete map[CSS_PROPERTY_BY_KEY[key]];
  }
  return serializeStyleDeclarations(map);
}

/** Match a whole selection that is already a single styled span. */
const EXACT_SPAN_RE =
  /^<span(\s+[^>]*)?\s+style\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*)<\/span>$/i;

export type ParsedStyledSpan = {
  beforeAttrs: string;
  style: string;
  afterAttrs: string;
  content: string;
};

export function parseExactStyledSpan(text: string): ParsedStyledSpan | null {
  const match = EXACT_SPAN_RE.exec(text.trim());
  if (!match) return null;
  // Reject nested spans to avoid ambiguous merges.
  if (/<\/?span\b/i.test(match[5])) return null;
  return {
    beforeAttrs: match[1] ?? "",
    style: match[3] ?? "",
    afterAttrs: match[4] ?? "",
    content: match[5],
  };
}

export function buildStyledSpan(content: string, style: string): string {
  return `<span style="${style}">${content}</span>`;
}

export function cssKeyToPatchKey(property: string): InlineTextStyleKey | undefined {
  return KEY_BY_CSS_PROPERTY[property];
}
