import type { Options as ReactMarkdownOptions } from "react-markdown";
import rehypeRaw from "rehype-raw";
import type { Options as SanitizeSchema } from "rehype-sanitize";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

/** CSS properties allowed on sanitized Markdown HTML. */
export const SAFE_STYLE_PROPERTIES = [
  "color",
  "background-color",
  "text-align",
  "font-size",
  "font-weight",
  "opacity",
] as const;

const SAFE_STYLE_PROPERTY_SET = new Set<string>(SAFE_STYLE_PROPERTIES);

const UNSAFE_STYLE_VALUE_RE =
  /url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:|binding\s*:|-moz-binding/i;

const EXTRA_TAG_NAMES = [
  "abbr",
  "aside",
  "center",
  "figcaption",
  "figure",
  "mark",
  "small",
  "u",
] as const;

type AttrList = NonNullable<SanitizeSchema["attributes"]>[string];

type HastNode = {
  type: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function mergeAttrLists(...lists: Array<AttrList | undefined>): AttrList {
  const result: AttrList = [];
  for (const list of lists) {
    if (!list) continue;
    for (const item of list) result.push(item);
  }
  return result;
}

/**
 * Sanitize an inline CSS `style` attribute value.
 * Keeps only whitelisted properties with safe values.
 */
export function sanitizeInlineStyle(style: string): string | undefined {
  const kept: string[] = [];
  for (const declaration of style.split(";")) {
    const trimmed = declaration.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const property = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    if (!property || !value) continue;
    if (!SAFE_STYLE_PROPERTY_SET.has(property)) continue;
    if (UNSAFE_STYLE_VALUE_RE.test(value)) continue;
    // Reject values that try to escape the declaration.
    if (/[<>{}]|\\/.test(value)) continue;
    kept.push(`${property}: ${value}`);
  }
  return kept.length > 0 ? kept.join("; ") : undefined;
}

/** Schema for user Markdown HTML (notes + file preview). */
export const noteMarkdownHtmlSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), ...EXTRA_TAG_NAMES],
  attributes: {
    ...defaultSchema.attributes,
    "*": mergeAttrLists(defaultSchema.attributes?.["*"], ["style", "className"]),
    div: mergeAttrLists(defaultSchema.attributes?.div, ["align"]),
    span: mergeAttrLists(defaultSchema.attributes?.span, ["align"]),
    p: mergeAttrLists(defaultSchema.attributes?.p, ["align"]),
    details: mergeAttrLists(defaultSchema.attributes?.details, ["open"]),
    abbr: mergeAttrLists(defaultSchema.attributes?.abbr, ["title"]),
  },
  strip: [...new Set([...(defaultSchema.strip ?? []), "script", "style"])],
};

/**
 * Rehype plugin: keep only safe declarations inside `style` attributes.
 */
export function rehypeSafeStyle() {
  return (tree: HastNode) => {
    visitElements(tree, (node) => {
      const props = node.properties;
      if (!props || props.style == null) return;
      const raw = props.style;
      const style =
        typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join(" ") : String(raw);
      const next = sanitizeInlineStyle(style);
      if (next) props.style = next;
      else delete props.style;
    });
  };
}

function visitElements(node: HastNode, visit: (element: HastNode) => void) {
  if (node.type === "element") visit(node);
  if (!node.children) return;
  for (const child of node.children) {
    if (child.type === "element") visitElements(child, visit);
  }
}

/** Shared rehype plugins for Markdown that may contain raw HTML (no KaTeX). */
export const noteMarkdownHtmlRehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, noteMarkdownHtmlSchema],
  rehypeSafeStyle,
] as NonNullable<ReactMarkdownOptions["rehypePlugins"]>;

/** Test helper: drop event handlers / javascript: and sanitize style. */
export function sanitizeElementProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...properties };
  for (const key of Object.keys(next)) {
    if (/^on/i.test(key)) delete next[key];
  }
  if (typeof next.href === "string" && /^\s*javascript:/i.test(next.href)) {
    delete next.href;
  }
  if (typeof next.style === "string") {
    const style = sanitizeInlineStyle(next.style);
    if (style) next.style = style;
    else delete next.style;
  }
  return next;
}
