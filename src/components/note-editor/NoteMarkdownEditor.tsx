import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useTheme } from "@/context/ThemeContext";
import { codeMirrorFileViewExtensions } from "@/lib/codeMirrorFileView";
import type { NoteColors } from "@/lib/themes";

export interface NoteMarkdownEditorHandle {
  setMarkdown: (markdown: string) => void;
  getMarkdown: () => string;
  getView: () => EditorView | null;
  focus: () => void;
}

interface NoteMarkdownEditorProps {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  className?: string;
}

function isDarkColor(color: string) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return true;
  let r = 0;
  let g = 0;
  let b = 0;
  if (match[1].length === 3) {
    r = Number.parseInt(match[1][0] + match[1][0], 16);
    g = Number.parseInt(match[1][1] + match[1][1], 16);
    b = Number.parseInt(match[1][2] + match[1][2], 16);
  } else {
    r = Number.parseInt(match[1].slice(0, 2), 16);
    g = Number.parseInt(match[1].slice(2, 4), 16);
    b = Number.parseInt(match[1].slice(4, 6), 16);
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
}

function noteEditorTheme(colors: NoteColors) {
  const selection = colors.selectionBackground || `${colors.primary}66`;
  const caret = colors.syntax.cursor || colors.text;
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        fontSize: "14px",
        backgroundColor: colors.bgPanel,
        color: colors.text,
        caretColor: caret,
      },
      "&.cm-focused": {
        outline: "none",
      },
      ".cm-content": {
        padding: "12px 16px",
        lineHeight: "1.65",
        caretColor: caret,
        color: colors.text,
        backgroundColor: colors.bgPanel,
      },
      ".cm-content ::selection": {
        backgroundColor: selection,
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: caret,
      },
      // Match CodeMirror's high-specificity focused selection layer selectors.
      ".cm-selectionBackground": {
        backgroundColor: selection,
      },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
        backgroundColor: selection,
      },
      ".cm-scroller": {
        fontFamily: "var(--font-mono), 'JetBrains Mono', ui-monospace, monospace",
        backgroundColor: colors.bgPanel,
        color: colors.text,
        overflowX: "auto",
      },
      ".cm-gutters": {
        backgroundColor: colors.bgPanel,
        color: colors.textMuted,
        borderRight: "1px solid",
        borderRightColor: `color-mix(in srgb, ${colors.text} 14%, transparent)`,
      },
      ".cm-activeLine": {
        backgroundColor: `${colors.bgHover}cc`,
      },
      ".cm-activeLineGutter": {
        backgroundColor: colors.bgPanel,
      },
    },
    { dark: isDarkColor(colors.bgPanel) },
  );
}

const NoteMarkdownEditor = forwardRef<NoteMarkdownEditorHandle, NoteMarkdownEditorProps>(
  function NoteMarkdownEditor({ initialMarkdown, onChange, className }, ref) {
    const { noteTheme } = useTheme();
    const parentRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const themeCompartmentRef = useRef(new Compartment());
    const onChangeRef = useRef(onChange);
    const suppressChangeRef = useRef(false);
    const initialMarkdownRef = useRef(initialMarkdown);
    const colors = noteTheme.colors.notes;

    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    useImperativeHandle(
      ref,
      () => ({
        setMarkdown: (markdown: string) => {
          const view = viewRef.current;
          if (!view) return;
          const current = view.state.doc.toString();
          if (current === markdown) return;
          suppressChangeRef.current = true;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: markdown },
          });
          suppressChangeRef.current = false;
        },
        getMarkdown: () => viewRef.current?.state.doc.toString() ?? "",
        getView: () => viewRef.current,
        focus: () => viewRef.current?.focus(),
      }),
      [],
    );

    // Mount once; theme updates go through the compartment below.
    useEffect(() => {
      const parent = parentRef.current;
      if (!parent) return;

      const view = new EditorView({
        parent,
        doc: initialMarkdownRef.current,
        extensions: [
          ...codeMirrorFileViewExtensions("markdown", {
            editable: true,
            allowScrollPastEnd: false,
            // Fixed line heights: avoids blank gaps when scrolling large notes.
            lineWrapping: false,
            updateListener: EditorView.updateListener.of((update) => {
              if (!update.docChanged || suppressChangeRef.current) return;
              onChangeRef.current(update.state.doc.toString());
            }),
          }),
          themeCompartmentRef.current.of(noteEditorTheme(colors)),
        ],
      });
      viewRef.current = view;

      return () => {
        view.destroy();
        if (viewRef.current === view) viewRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- remount via parent key when note changes
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: themeCompartmentRef.current.reconfigure(noteEditorTheme(colors)),
      });
    }, [colors]);

    return (
      <div
        ref={parentRef}
        className={className ?? "h-full min-h-0 w-full overflow-hidden"}
        style={{
          backgroundColor: colors.bgPanel,
          color: colors.text,
          caretColor: colors.syntax.cursor || colors.text,
          colorScheme: isDarkColor(colors.bgPanel) ? "dark" : "light",
        }}
      />
    );
  },
);

export default NoteMarkdownEditor;
