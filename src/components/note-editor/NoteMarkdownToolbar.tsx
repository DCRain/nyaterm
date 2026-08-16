import { redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
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
  setHeading,
  wrapSelection,
} from "@/lib/noteMarkdownActions";
import { cn } from "@/lib/utils";

interface NoteMarkdownToolbarProps {
  getView: () => EditorView | null;
  className?: string;
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

export default function NoteMarkdownToolbar({ getView, className }: NoteMarkdownToolbarProps) {
  const { t } = useTranslation();

  const run = (action: (view: EditorView) => void) => {
    const view = getView();
    if (view) action(view);
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
      <ToolbarButton
        label={t("notes.toolbar.heading1")}
        onClick={() => run((view) => setHeading(view, 1))}
      >
        <span className="text-[10px] font-semibold">H1</span>
      </ToolbarButton>
      <ToolbarButton
        label={t("notes.toolbar.heading2")}
        onClick={() => run((view) => setHeading(view, 2))}
      >
        <span className="text-[10px] font-semibold">H2</span>
      </ToolbarButton>
      <ToolbarButton
        label={t("notes.toolbar.heading3")}
        onClick={() => run((view) => setHeading(view, 3))}
      >
        <span className="text-[10px] font-semibold">H3</span>
      </ToolbarButton>
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
