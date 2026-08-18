import { redo, undo } from "@codemirror/commands";
import { Compartment, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MdAccountTree,
  MdBarChart,
  MdChecklist,
  MdCode,
  MdFormatBold,
  MdFormatColorFill,
  MdFormatColorText,
  MdFormatItalic,
  MdFormatListBulleted,
  MdFormatListNumbered,
  MdFormatQuote,
  MdFormatSize,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/context/ThemeContext";
import {
  INLINE_FONT_SIZE_PRESETS,
  type InlineFontSizePreset,
} from "@/lib/inlineTextStyle";
import {
  applyInlineTextStyle,
  clearInlineTextStyle,
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
import InsertTablePopover from "@/components/dialog/note-editor/InsertTablePopover";
import type { NoteColors } from "@/lib/themes";
import { cn } from "@/lib/utils";

interface NoteMarkdownToolbarProps {
  getView: () => EditorView | null;
  /** Bumps when the editor view (re)mounts so the toolbar can rebind. */
  viewEpoch?: number;
  className?: string;
}

const BLOCK_STYLE_OPTIONS: NoteBlockStyleLevel[] = [0, 1, 2, 3, 4, 5];

const BACKGROUND_PRESETS = [
  "#fef3c7",
  "#dcfce7",
  "#dbeafe",
  "#fce7f3",
  "#ede9fe",
  "#ffedd5",
  "#e2e8f0",
  "#fecaca",
] as const;

function blockStyleLabelKey(level: NoteBlockStyleLevel) {
  return level === 0 ? "notes.toolbar.paragraph" : `notes.toolbar.heading${level}`;
}

function fontSizeLabelKey(size: InlineFontSizePreset) {
  switch (size) {
    case "12px":
      return "notes.toolbar.fontSizeSmall";
    case "14px":
      return "notes.toolbar.fontSizeNormal";
    case "16px":
      return "notes.toolbar.fontSizeLarge";
    case "18px":
      return "notes.toolbar.fontSizeLarger";
    case "20px":
      return "notes.toolbar.fontSizeXLarge";
    case "24px":
      return "notes.toolbar.fontSizeXXLarge";
    default:
      return "notes.toolbar.fontSize";
  }
}

function textColorPresets(colors: NoteColors): string[] {
  const candidates = [
    colors.text,
    colors.textMuted,
    colors.primary,
    colors.link,
    colors.danger,
    colors.syntax.red,
    colors.syntax.green,
    colors.syntax.blue,
    colors.syntax.yellow,
    colors.syntax.magenta,
    colors.syntax.cyan,
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const color of candidates) {
    const key = color.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(color);
  }
  return result;
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

function ColorSwatchButton({
  color,
  label,
  onSelect,
}: {
  color: string;
  label: string;
  onSelect: (color: string) => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="size-5 rounded-sm border border-[var(--df-border)] transition-transform hover:scale-110"
      style={{ backgroundColor: color }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSelect(color)}
    />
  );
}

function ColorStylePopover({
  label,
  icon,
  presets,
  onPick,
  onClear,
}: {
  label: string;
  icon: React.ReactNode;
  presets: string[];
  onPick: (color: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={label}
          aria-label={label}
          className="h-7 w-7 hover:text-[var(--df-text)]"
          style={{ color: "var(--df-text-muted)" }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {icon}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-auto min-w-[11rem] border-[var(--df-border)] bg-[var(--df-bg-panel)] p-2 text-[var(--df-text)]"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="mb-2 grid grid-cols-5 gap-1.5">
          {presets.map((color) => (
            <ColorSwatchButton
              key={color}
              color={color}
              label={color}
              onSelect={(next) => {
                onPick(next);
                setOpen(false);
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex flex-1 items-center gap-2 rounded-md border border-[var(--df-border)] px-2 py-1 text-xs text-[var(--df-text-muted)]">
            <span>{t("notes.toolbar.customColor")}</span>
            <input
              type="color"
              className="h-5 w-8 cursor-pointer border-0 bg-transparent p-0"
              onMouseDown={(event) => event.preventDefault()}
              onChange={(event) => {
                onPick(event.target.value);
                setOpen(false);
              }}
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-[var(--df-text-muted)]"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onClear();
              setOpen(false);
            }}
          >
            {t("notes.toolbar.clearStyle")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function NoteMarkdownToolbar({
  getView,
  viewEpoch = 0,
  className,
}: NoteMarkdownToolbarProps) {
  const { t } = useTranslation();
  const { noteTheme } = useTheme();
  const [blockStyle, setBlockStyle] = useState("0");
  const [fontSize, setFontSize] = useState<string>("");
  const getViewRef = useRef(getView);
  getViewRef.current = getView;

  const colorPresets = useMemo(
    () => textColorPresets(noteTheme.colors.notes),
    [noteTheme.colors.notes],
  );

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

  const applyFontSize = (value: string | null) => {
    if (value == null || value === "") return;
    if (value === "__clear__") {
      setFontSize("");
      run((view) => clearInlineTextStyle(view, ["fontSize"]));
      return;
    }
    setFontSize(value);
    run((view) => applyInlineTextStyle(view, { fontSize: value }));
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
      <ColorStylePopover
        label={t("notes.toolbar.textColor")}
        icon={<MdFormatColorText className="size-4" />}
        presets={colorPresets}
        onPick={(color) => run((view) => applyInlineTextStyle(view, { color }))}
        onClear={() => run((view) => clearInlineTextStyle(view, ["color"]))}
      />
      <ColorStylePopover
        label={t("notes.toolbar.backgroundColor")}
        icon={<MdFormatColorFill className="size-4" />}
        presets={[...BACKGROUND_PRESETS]}
        onPick={(color) => run((view) => applyInlineTextStyle(view, { backgroundColor: color }))}
        onClear={() => run((view) => clearInlineTextStyle(view, ["backgroundColor"]))}
      />
      <Select value={fontSize || undefined} onValueChange={applyFontSize}>
        <SelectTrigger
          size="sm"
          aria-label={t("notes.toolbar.fontSize")}
          title={t("notes.toolbar.fontSize")}
          className={cn(
            "h-7 w-auto min-w-[4.5rem] gap-1 rounded-md border-0 bg-transparent px-1.5 py-0 text-xs shadow-none",
            "text-[var(--df-text-muted)] hover:bg-accent hover:text-[var(--df-text)]",
            "focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent dark:hover:bg-accent/50",
            "[&_svg]:size-3.5 [&_svg]:opacity-70",
          )}
          onMouseDown={(event) => event.preventDefault()}
        >
          <MdFormatSize className="size-3.5 shrink-0 opacity-70" />
          <SelectValue placeholder={t("notes.toolbar.fontSize")} />
        </SelectTrigger>
        <SelectContent
          position="popper"
          align="start"
          className="min-w-[8rem] border-[var(--df-border)] bg-[var(--df-bg-panel)] text-[var(--df-text)]"
        >
          {INLINE_FONT_SIZE_PRESETS.map((size) => (
            <SelectItem
              key={size}
              value={size}
              className="text-xs text-[var(--df-text-muted)] focus:bg-[color-mix(in_srgb,var(--df-text)_10%,transparent)] focus:text-[var(--df-text)]"
            >
              {t(fontSizeLabelKey(size))}
            </SelectItem>
          ))}
          <SelectItem
            value="__clear__"
            className="text-xs text-[var(--df-text-muted)] focus:bg-[color-mix(in_srgb,var(--df-text)_10%,transparent)] focus:text-[var(--df-text)]"
          >
            {t("notes.toolbar.clearStyle")}
          </SelectItem>
        </SelectContent>
      </Select>
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
      <InsertTablePopover
        onInsert={(rows, cols) => run((view) => insertTable(view, rows, cols))}
        icon={<MdTableChart className="size-4" />}
        label={t("notes.toolbar.table")}
      />
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
