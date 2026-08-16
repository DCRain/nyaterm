import { redo, undo } from "@codemirror/commands";
import { Compartment, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MdAccountTree,
  MdBarChart,
  MdChecklist,
  MdCode,
  MdFormatBold,
  MdFormatItalic,
  MdFormatListBulleted,
  MdFormatListNumbered,
  MdFormatQuote,
  MdFunctions,
  MdHorizontalRule,
  MdLink,
  MdRedo,
  MdStrikethroughS,
  MdSwapHoriz,
  MdTableChart,
  MdUndo,
  MdViewTimeline,
} from "react-icons/md";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  detectBlockStyleLevelAtCursor,
  insertBlockMath,
  insertBulletList,
  insertCodeBlock,
  insertECharts,
  insertHorizontalRule,
  insertInlineMath,
  insertLink,
  insertMermaidFlowchart,
  insertMermaidGantt,
  insertMermaidSequence,
  insertOrderedList,
  insertQuote,
  insertTable,
  insertTaskList,
  type NoteBlockStyleLevel,
  setHeading,
  wrapSelection,
} from "@/lib/noteMarkdownActions";
import { cn } from "@/lib/utils";

interface NoteMarkdownToolbarProps {
  getView: () => EditorView | null;
  /** Bumps when the editor view (re)mounts so the toolbar can rebind. */
  viewEpoch?: number;
  className?: string;
}

const BLOCK_STYLE_OPTIONS: NoteBlockStyleLevel[] = [0, 1, 2, 3, 4, 5];

function blockStyleLabelKey(level: NoteBlockStyleLevel) {
  return level === 0 ? "notes.toolbar.paragraph" : `notes.toolbar.heading${level}`;
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      className="h-7 w-7 hover:text-[var(--df-text)]"
      style={{ color: "var(--df-text-muted)" }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function Separator() {
  return <div className="mx-0.5 h-4 w-px shrink-0 bg-[var(--df-border)]" />;
}

export default function NoteMarkdownToolbar({
  getView,
  viewEpoch = 0,
  className,
}: NoteMarkdownToolbarProps) {
  const { t } = useTranslation();
  const [blockStyle, setBlockStyle] = useState("0");
  const getViewRef = useRef(getView);
  getViewRef.current = getView;

  useEffect(() => {
    let cancelled = false;
    let attached: EditorView | null = null;
    let compartment: Compartment | null = null;
    let retryTimer = 0;

    const syncFromView = (view: EditorView) => {
      const next = String(detectBlockStyleLevelAtCursor(view));
      setBlockStyle((prev) => (prev === next ? prev : next));
    };

    const detach = () => {
      if (attached && compartment) {
        try {
          attached.dispatch({ effects: compartment.reconfigure([]) });
        } catch {
          // View may already be destroyed.
        }
      }
      attached = null;
      compartment = null;
    };

    const attach = (view: EditorView) => {
      if (attached === view) return;
      detach();
      attached = view;
      compartment = new Compartment();
      syncFromView(view);
      try {
        view.dispatch({
          effects: StateEffect.appendConfig.of(
            compartment.of(
              EditorView.updateListener.of((update) => {
                if (update.selectionSet || update.docChanged) {
                  syncFromView(update.view);
                }
              }),
            ),
          ),
        });
      } catch {
        attached = null;
        compartment = null;
      }
    };

    const watch = () => {
      if (cancelled) return;
      const view = getViewRef.current();
      if (view) attach(view);
      else detach();
      retryTimer = window.setTimeout(watch, view ? 400 : 80);
    };

    watch();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      detach();
    };
  }, [viewEpoch]);

  const run = (action: (view: EditorView) => void) => {
    const view = getViewRef.current();
    if (view) action(view);
  };

  const applyBlockStyle = (value: string | null) => {
    if (value == null) return;
    const level = Number(value) as NoteBlockStyleLevel;
    if (![0, 1, 2, 3, 4, 5].includes(level)) return;
    setBlockStyle(value);
    run((view) => setHeading(view, level));
  };

  return (
    <div
      className={cn(
        "nyaterm-note-toolbar flex min-h-8 flex-wrap items-center justify-center gap-0.5 px-2 py-1",
        className,
      )}
      style={{
        backgroundColor: "var(--df-bg-panel)",
        color: "var(--df-text)",
      }}
    >
      <ToolbarButton label={t("notes.toolbar.undo")} onClick={() => run((view) => undo(view))}>
        <MdUndo className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={t("notes.toolbar.redo")} onClick={() => run((view) => redo(view))}>
        <MdRedo className="size-4" />
      </ToolbarButton>
      <Separator />
      <Select value={blockStyle} onValueChange={applyBlockStyle}>
        <SelectTrigger
          size="sm"
          aria-label={t("notes.toolbar.blockStyle")}
          title={t("notes.toolbar.blockStyle")}
          className={cn(
            "h-7 w-auto min-w-[4.75rem] gap-1 rounded-md border-0 bg-transparent px-1.5 py-0 text-xs shadow-none",
            "text-[var(--df-text-muted)] hover:bg-accent hover:text-[var(--df-text)]",
            "focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent dark:hover:bg-accent/50",
            "[&_svg]:size-3.5 [&_svg]:opacity-70",
          )}
          onMouseDown={(event) => event.preventDefault()}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          position="popper"
          align="start"
          className="min-w-[7.5rem] border-[var(--df-border)] bg-[var(--df-bg-panel)] text-[var(--df-text)]"
        >
          {BLOCK_STYLE_OPTIONS.map((level) => (
            <SelectItem
              key={level}
              value={String(level)}
              className="text-xs text-[var(--df-text-muted)] focus:bg-[color-mix(in_srgb,var(--df-text)_10%,transparent)] focus:text-[var(--df-text)]"
            >
              {t(blockStyleLabelKey(level))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Separator />
      <ToolbarButton
        label={t("notes.toolbar.bold")}
        onClick={() => run((view) => wrapSelection(view, "**", "**", "bold"))}
      >
        <MdFormatBold className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label={t("notes.toolbar.italic")}
        onClick={() => run((view) => wrapSelection(view, "*", "*", "italic"))}
      >
        <MdFormatItalic className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label={t("notes.toolbar.strikethrough")}
        onClick={() => run((view) => wrapSelection(view, "~~", "~~", "text"))}
      >
        <MdStrikethroughS className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label={t("notes.toolbar.inlineCode")}
        onClick={() => run((view) => wrapSelection(view, "`", "`", "code"))}
      >
        <MdCode className="size-4" />
      </ToolbarButton>
      <Separator />
      <ToolbarButton label={t("notes.toolbar.bulletList")} onClick={() => run(insertBulletList)}>
        <MdFormatListBulleted className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={t("notes.toolbar.orderedList")} onClick={() => run(insertOrderedList)}>
        <MdFormatListNumbered className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={t("notes.toolbar.taskList")} onClick={() => run(insertTaskList)}>
        <MdChecklist className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={t("notes.toolbar.quote")} onClick={() => run(insertQuote)}>
        <MdFormatQuote className="size-4" />
      </ToolbarButton>
      <Separator />
      <ToolbarButton label={t("notes.toolbar.link")} onClick={() => run(insertLink)}>
        <MdLink className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={t("notes.toolbar.codeBlock")} onClick={() => run(insertCodeBlock)}>
        <span className="font-mono text-[10px]">{"{}"}</span>
      </ToolbarButton>
      <ToolbarButton label={t("notes.toolbar.table")} onClick={() => run(insertTable)}>
        <MdTableChart className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label={t("notes.toolbar.horizontalRule")}
        onClick={() => run(insertHorizontalRule)}
      >
        <MdHorizontalRule className="size-4" />
      </ToolbarButton>
      <Separator />
      <ToolbarButton
        label={t("notes.toolbar.flowchart")}
        onClick={() => run(insertMermaidFlowchart)}
      >
        <MdAccountTree className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label={t("notes.toolbar.sequenceDiagram")}
        onClick={() => run(insertMermaidSequence)}
      >
        <MdSwapHoriz className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={t("notes.toolbar.gantt")} onClick={() => run(insertMermaidGantt)}>
        <MdViewTimeline className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={t("notes.toolbar.echarts")} onClick={() => run(insertECharts)}>
        <MdBarChart className="size-4" />
      </ToolbarButton>
      <Separator />
      <ToolbarButton label={t("notes.toolbar.inlineMath")} onClick={() => run(insertInlineMath)}>
        <span className="font-serif text-[11px] font-semibold italic">𝑥</span>
      </ToolbarButton>
      <ToolbarButton label={t("notes.toolbar.blockMath")} onClick={() => run(insertBlockMath)}>
        <MdFunctions className="size-4" />
      </ToolbarButton>
    </div>
  );
}
