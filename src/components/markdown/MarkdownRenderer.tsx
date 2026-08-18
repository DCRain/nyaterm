import "katex/dist/katex.min.css";

import { type CSSProperties, useMemo } from "react";
import type { Components, ExtraProps } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import EChartsBlock from "@/components/markdown/EChartsBlock";
import MermaidBlock from "@/components/markdown/MermaidBlock";
import { useTheme } from "@/context/ThemeContext";
import { prepareNoteMarkdownForPreview } from "@/lib/markdownHardBreaks";
import { noteMarkdownHtmlRehypePlugins } from "@/lib/markdownHtmlSchema";
import { buildPrismThemeFromNoteColors } from "@/lib/prismTheme";
import type { NoteColors } from "@/lib/themes";
import { cn } from "@/lib/utils";

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  rs: "rust",
  csharp: "csharp",
  "c#": "csharp",
  "c++": "cpp",
  plaintext: "text",
  text: "text",
};

const MERMAID_LANGUAGES = new Set(["mermaid", "flowchart", "sequence", "gantt"]);

function normalizeLanguage(raw: string | undefined) {
  if (!raw) return "text";
  const key = raw.trim().toLowerCase();
  return LANGUAGE_ALIASES[key] ?? key;
}

function toMermaidSource(language: string, code: string) {
  const trimmed = code.trim();
  const lower = trimmed.toLowerCase();
  if (language === "flowchart" && !/^(flowchart|graph)\b/.test(lower)) {
    return `flowchart TD\n${trimmed}`;
  }
  if (language === "sequence" && !/^sequencediagram\b/.test(lower)) {
    return `sequenceDiagram\n${trimmed}`;
  }
  if (language === "gantt" && !/^gantt\b/.test(lower)) {
    return `gantt\n${trimmed}`;
  }
  return trimmed;
}

function sourceLineAttr(node: ExtraProps["node"]): Record<string, number> {
  const line = node?.position?.start?.line;
  return typeof line === "number" ? { "data-source-line": line } : {};
}

/** Table stroke — keep the same token as other note chrome. */
function noteStrokeFromColors(colors: NoteColors): string {
  return colors.border;
}

/** Resolve task index from live DOM order (avoids Strict Mode render counters). */
function resolveTaskIndex(el: Element): number {
  const root = el.closest(".nyaterm-note-preview");
  if (!root) return -1;
  const boxes = root.querySelectorAll('[data-nyaterm-task="true"]');
  return Array.prototype.indexOf.call(boxes, el);
}

function createMarkdownComponents(
  colors: NoteColors,
  prismStyle: Record<string, CSSProperties>,
  options: {
    interactiveTasks?: boolean;
    onTaskToggle?: (index: number, checked: boolean) => void;
  } = {},
): Components {
  const { interactiveTasks = false, onTaskToggle } = options;

  return {
    h1: ({ children, node }) => <h1 {...sourceLineAttr(node)}>{children}</h1>,
    h2: ({ children, node }) => <h2 {...sourceLineAttr(node)}>{children}</h2>,
    h3: ({ children, node }) => <h3 {...sourceLineAttr(node)}>{children}</h3>,
    h4: ({ children, node }) => <h4 {...sourceLineAttr(node)}>{children}</h4>,
    h5: ({ children, node }) => <h5 {...sourceLineAttr(node)}>{children}</h5>,
    h6: ({ children, node }) => <h6 {...sourceLineAttr(node)}>{children}</h6>,
    p: ({ children, node }) => <p {...sourceLineAttr(node)}>{children}</p>,
    a: ({ children, href }) => (
      <a
        className="underline underline-offset-2"
        style={{ color: colors.link }}
        href={href}
        target="_blank"
        rel="noreferrer"
      >
        {children}
      </a>
    ),
    img: ({ alt }) => (
      <span
        className="rounded px-1.5 py-0.5 text-xs"
        style={{
          backgroundColor: colors.bgHover,
          color: colors.textMuted,
        }}
      >
        {alt || "image"}
      </span>
    ),
    input: ({ type, checked }) => {
      if (type !== "checkbox") return null;
      const isChecked = Boolean(checked);
      if (!interactiveTasks || !onTaskToggle) {
        return (
          <input
            type="checkbox"
            checked={isChecked}
            disabled
            readOnly
            className="mt-1 size-3.5 shrink-0"
            style={{ accentColor: colors.primary }}
          />
        );
      }
      return (
        // GFM emits disabled native checkboxes; use a button so preview toggles work in WebView.
        // biome-ignore lint/a11y/useSemanticElements: intentional button checkbox for interactive note preview
        <button
          type="button"
          role="checkbox"
          aria-checked={isChecked}
          data-nyaterm-task="true"
          className="relative z-10 mt-1 flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-[3px] border p-0"
          style={{
            borderColor: colors.border,
            backgroundColor: isChecked ? colors.primary : colors.bgHover,
            color: isChecked ? colors.bgPanel : "transparent",
          }}
          aria-label={isChecked ? "Mark task incomplete" : "Mark task complete"}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const index = resolveTaskIndex(event.currentTarget);
            if (index < 0) return;
            onTaskToggle(index, !isChecked);
          }}
        >
          <svg
            viewBox="0 0 16 16"
            className="size-2.5"
            aria-hidden="true"
            style={{ opacity: isChecked ? 1 : 0 }}
          >
            <path fill="currentColor" d="M6.5 11.2 3.3 8l1.1-1.1 2.1 2.1 5-5L12.6 5l-6.1 6.2Z" />
          </svg>
        </button>
      );
    },
    li: ({ children, className, node, ...props }) => {
      const isTask = className?.includes("task-list-item");
      return (
        <li
          className={cn(className, isTask && "flex list-none items-start gap-2")}
          {...sourceLineAttr(node)}
          {...props}
        >
          {children}
        </li>
      );
    },
    ul: ({ children, className, node, ...props }) => (
      <ul
        className={cn(
          className,
          className?.includes("contains-task-list") ? "list-none pl-1" : "list-disc pl-6",
        )}
        {...sourceLineAttr(node)}
        {...props}
      >
        {children}
      </ul>
    ),
    ol: ({ children, className, node, ...props }) => (
      <ol
        className={cn(className, "list-decimal pl-6")}
        {...sourceLineAttr(node)}
        {...props}
      >
        {children}
      </ol>
    ),
    pre: ({ children }) => <>{children}</>,
    code: ({ children, className, node }) => {
      const languageMatch = /language-([\w+#.-]+)/.exec(className ?? "");
      const codeText = String(children).replace(/\n$/, "");
      const lineAttr = sourceLineAttr(node);
      // Fenced blocks often omit a language tag; treat multiline as a block.
      const isBlock = Boolean(languageMatch) || codeText.includes("\n");

      const renderPlainBlock = (text: string) => (
        <pre
          {...lineAttr}
          className="nyaterm-md-code-block my-3 overflow-x-auto rounded-md border p-3 font-mono text-[0.8125rem] leading-[1.45]"
          style={{
            borderColor: colors.border,
            backgroundColor: colors.syntax.background,
            color: colors.syntax.foreground,
            whiteSpace: "pre",
            tabSize: 4,
          }}
        >
          {text}
        </pre>
      );

      if (!isBlock) {
        return (
          <code
            className="nyaterm-md-inline-code rounded px-1 py-0.5 font-mono text-xs"
            style={{
              backgroundColor: `${colors.bgHover}cc`,
              color: colors.text,
            }}
          >
            {children}
          </code>
        );
      }

      const rawLanguage = languageMatch?.[1]?.toLowerCase();
      if (!rawLanguage || rawLanguage === "text" || rawLanguage === "plaintext") {
        return renderPlainBlock(codeText);
      }
      if (MERMAID_LANGUAGES.has(rawLanguage)) {
        return (
          <div {...lineAttr}>
            <MermaidBlock source={toMermaidSource(rawLanguage, codeText)} colors={colors} />
          </div>
        );
      }
      if (rawLanguage === "echarts" || rawLanguage === "chart") {
        return (
          <div {...lineAttr}>
            <EChartsBlock source={codeText} colors={colors} />
          </div>
        );
      }
      const language = normalizeLanguage(rawLanguage);
      const lineCount = codeText.split("\n").length;
      return (
        <div {...lineAttr}>
          <SyntaxHighlighter
            language={language}
            style={prismStyle}
            PreTag="div"
            className="nyaterm-md-code-block"
            customStyle={{
              margin: "0.75rem 0",
              padding: "0.9rem 1rem",
              fontSize: "0.8125rem",
              lineHeight: "1.55",
              borderRadius: "0.375rem",
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.syntax.background,
              color: colors.syntax.foreground,
            }}
            codeTagProps={{
              style: {
                fontFamily: "var(--font-mono), 'JetBrains Mono', ui-monospace, monospace",
              },
            }}
            showLineNumbers={lineCount > 3 && lineCount <= 200}
            wrapLongLines={false}
          >
            {codeText}
          </SyntaxHighlighter>
        </div>
      );
    },
    table: ({ children, node }) => (
      <div className="terminal-scroll my-3 max-w-full overflow-x-auto" {...sourceLineAttr(node)}>
        <table
          className="w-full text-left text-sm"
          style={{
            color: colors.text,
            borderCollapse: "separate",
            borderSpacing: 0,
            border: `1px solid ${noteStrokeFromColors(colors)}`,
          }}
        >
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => (
      <th
        className="px-2 py-1.5 font-medium"
        style={{
          boxShadow: `inset 0 0 0 1px ${noteStrokeFromColors(colors)}`,
          backgroundColor: colors.bgHover,
        }}
      >
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td
        className="px-2 py-1.5"
        style={{
          boxShadow: `inset 0 0 0 1px ${noteStrokeFromColors(colors)}`,
        }}
      >
        {children}
      </td>
    ),
    blockquote: ({ children, node }) => (
      <blockquote
        {...sourceLineAttr(node)}
        style={{
          borderLeft: `3px solid ${colors.primary}`,
          paddingLeft: "0.9rem",
          color: colors.textMuted,
        }}
      >
        {children}
      </blockquote>
    ),
    hr: ({ node }) => (
      <hr
        {...sourceLineAttr(node)}
        style={{ borderColor: colors.border }}
        className="my-4 border-t"
      />
    ),
  };
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /** Override note palette; defaults to the resolved note theme. */
  colors?: NoteColors;
  /**
   * When set, GFM task checkboxes are interactive and report toggles by
   * document order (0-based). Omit for read-only previews elsewhere.
   */
  onTaskToggle?: (index: number, checked: boolean) => void;
}

export default function MarkdownRenderer({
  content,
  className,
  colors,
  onTaskToggle,
}: MarkdownRendererProps) {
  const { noteTheme } = useTheme();
  const themeColors = colors ?? noteTheme.colors.notes;
  const prismStyle = useMemo(() => buildPrismThemeFromNoteColors(themeColors), [themeColors]);
  const components = useMemo(
    () =>
      createMarkdownComponents(themeColors, prismStyle, {
        interactiveTasks: Boolean(onTaskToggle),
        onTaskToggle,
      }),
    [themeColors, prismStyle, onTaskToggle],
  );
  const renderedContent = useMemo(() => prepareNoteMarkdownForPreview(content), [content]);

  return (
    <div
      className={cn(
        "nyaterm-note-preview terminal-scroll h-full w-full overflow-auto p-5 text-sm leading-6",
        className,
      )}
      style={{
        backgroundColor: themeColors.bgPanel,
        color: themeColors.text,
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
        rehypePlugins={[
          ...noteMarkdownHtmlRehypePlugins,
          [rehypeKatex, { throwOnError: false, strict: "ignore" }],
        ]}
        components={components}
      >
        {renderedContent}
      </ReactMarkdown>
    </div>
  );
}
