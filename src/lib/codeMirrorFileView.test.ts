import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { themeList } from "@/lib/themes";
import { codeMirrorFileViewExtensions, isDarkColor } from "./codeMirrorFileView";

const sampleColors = themeList[0].colors;

function findRules(fragment: string): string[] {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    const owner = sheet.ownerNode as HTMLStyleElement | null;
    // jsdom's cssText drops !important inside var() values, so read the raw
    // rule text from the mounted style tag instead.
    const text = owner?.textContent ?? "";
    for (const line of text.split("\n")) {
      if (line.includes(fragment)) {
        rules.push(line);
      }
    }
  }
  return rules;
}

function mountEditor(
  language = "plaintext",
  options?: Parameters<typeof codeMirrorFileViewExtensions>[1],
): HTMLDivElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  new EditorView({
    state: EditorState.create({
      doc: "#!/bin/bash\necho hello",
      extensions: codeMirrorFileViewExtensions(language, options),
    }),
    parent: host,
  });
  return host;
}

/**
 * Reads the compiled CSS for a given set of file-view extensions straight
 * from CodeMirror's `StyleModule`s via the `EditorState` facet, without ever
 * mounting to the DOM. `StyleModule.mount` keeps one shared `<style>` tag per
 * `document` and accumulates every module it has ever seen for the lifetime
 * of that document (see `style-mod`'s `StyleSet`), so scraping `document.head`
 * after mounting multiple editors in the same test file is unreliable —
 * rules from earlier tests' mounts never get cleared out, even if the
 * `<style>` element itself is removed. Reading the facet directly is
 * side-effect free and isolated per call.
 */
function extensionRuleText(options?: Parameters<typeof codeMirrorFileViewExtensions>[1]): string {
  const state = EditorState.create({
    doc: "hello",
    extensions: codeMirrorFileViewExtensions("plaintext", options),
  });
  return state
    .facet(EditorView.styleModule)
    .map((mod) => mod.getRules())
    .join("\n");
}

describe("codeMirrorFileView selection styling", () => {
  it("renders the editor selection with the terminal selection color", () => {
    const host = mountEditor();

    try {
      const rules = findRules("cm-selectionBackground").join("\n");
      expect(rules).toContain("var(--df-terminal-selection");
      expect(rules).toContain("!important");
    } finally {
      host.remove();
    }
  });

  it("keeps the active line highlight below the selection layer", () => {
    const host = mountEditor();

    try {
      // CodeMirror draws its selection layer below in-flow line backgrounds,
      // so the highlight must live on a ::before with z-index under the
      // selection layer (-2), not on the line element itself.
      const activeLineRules = findRules("cm-activeLine").filter(
        (rule) => !rule.includes("cm-activeLineGutter"),
      );
      const beforeRule = activeLineRules.find((rule) => rule.includes(":before"));

      expect(beforeRule).toBeDefined();
      expect(beforeRule).toContain("z-index: -3");
      expect(beforeRule).toContain("color-mix(in srgb, var(--muted) 22%, transparent)");

      const lineRules = activeLineRules.filter((rule) => !rule.includes(":before"));
      // The CodeMirror base theme also styles .cm-activeLine (#cceeff44);
      // our theme's rule is the one that clears the element background.
      const ownLineRule = lineRules.find((rule) => rule.includes("background-color: transparent"));
      expect(ownLineRule).toBeDefined();
      expect(ownLineRule).toContain("position: relative");
    } finally {
      host.remove();
    }
  });
});

describe("codeMirrorFileView search panel styling", () => {
  it("removes CodeMirror's light button gradient and uses theme colors", () => {
    const host = mountEditor();

    try {
      const buttonRules = findRules("cm-search").filter((rule) => rule.includes("cm-button"));
      const baseRule = buttonRules.find(
        (rule) => rule.includes("background-image: none") && rule.includes("var(--secondary)"),
      );

      expect(baseRule).toBeDefined();
      expect(baseRule).toContain("color: var(--foreground)");
      expect(baseRule).toContain("border: 1px solid var(--border)");

      const activeRule = buttonRules.find((rule) => rule.includes("cm-button:active"));
      expect(activeRule).toContain("background-image: none");
    } finally {
      host.remove();
    }
  });

  it("uses the theme focus ring and checkbox accent", () => {
    const host = mountEditor();

    try {
      const searchRules = findRules("cm-search").join("\n");
      expect(searchRules).toContain("accent-color: var(--primary)");
      expect(searchRules).toContain("outline: 2px solid var(--ring)");
      expect(searchRules).toContain("color: var(--muted-foreground)");
    } finally {
      host.remove();
    }
  });
});

describe("codeMirrorFileView solidColors mode", () => {
  it("bakes literal theme colors into the editor surface instead of CSS variables", () => {
    const ruleText = extensionRuleText({ solidColors: sampleColors });

    // Literal colors from the provided theme must appear verbatim...
    expect(ruleText).toContain(sampleColors.bg);
    expect(ruleText).toContain(sampleColors.text);
    // ...and none of the `var(--df-*)` / `var(--foreground)` custom-property
    // references from the default (non-iframe) theme should leak through.
    expect(ruleText).not.toContain("var(--df-");
    expect(ruleText).not.toContain("var(--foreground)");
    expect(ruleText).not.toContain("var(--background)");
  });

  it("bakes literal syntax highlight colors instead of CSS variables", () => {
    const ruleText = extensionRuleText({ solidColors: sampleColors });

    expect(ruleText).toContain(sampleColors.primary);
    expect(ruleText).not.toContain("var(--df-primary)");
    expect(ruleText).not.toContain("var(--df-text-muted)");
  });

  it("falls back to the CSS-variable theme when no solidColors are provided", () => {
    const ruleText = extensionRuleText();

    expect(ruleText).toContain("var(--foreground)");
    expect(ruleText).toContain("var(--df-primary)");
  });

  it("bakes literal base text color on cm-content without forcing cm-line colors", () => {
    const ruleText = extensionRuleText({ solidColors: sampleColors });
    const contentRule = ruleText.split("}").find((rule) => rule.includes("user-select: text"));
    const lineRule = ruleText
      .split("}")
      .find((rule) => /\.cm-line\s*\{[^{]*cursor: text;/.test(`${rule}}`));

    expect(contentRule).toBeDefined();
    expect(contentRule).toContain(sampleColors.text);
    expect(lineRule).toBeDefined();
    expect(lineRule).not.toContain(`color: ${sampleColors.text}`);
  });

  it("disables scrollPastEnd in solidColors iframe mode", () => {
    const host = mountEditor("plaintext", { solidColors: sampleColors });
    try {
      // scrollPastEnd adds bottom padding on the content element; solidColors mode omits it.
      const content = host.querySelector(".cm-content") as HTMLElement | null;
      expect(content?.style.paddingBottom).not.toBe("50vh");
    } finally {
      host.remove();
    }
  });

  it("tokenizes shell sources with highlight spans in solidColors mode", () => {
    const host = mountEditor("shell", { solidColors: sampleColors });
    try {
      const spans = host.querySelectorAll(".cm-line span");
      expect(spans.length).toBeGreaterThan(0);
    } finally {
      host.remove();
    }
  });
});

describe("isDarkColor", () => {
  it("identifies dark literal hex backgrounds", () => {
    expect(isDarkColor("#0d1117")).toBe(true);
    expect(isDarkColor("#000000")).toBe(true);
  });

  it("identifies light literal hex backgrounds", () => {
    expect(isDarkColor("#ffffff")).toBe(false);
    expect(isDarkColor("#f5f5f5")).toBe(false);
  });

  it("defaults to dark for unparseable input (non-hex color values)", () => {
    expect(isDarkColor("not-a-color")).toBe(true);
  });
});
