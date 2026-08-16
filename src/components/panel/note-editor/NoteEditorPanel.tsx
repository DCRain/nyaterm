import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MdEditNote,
  MdFormatListBulleted,
  MdNotes,
  MdRefresh,
  MdSave,
  MdVerticalSplit,
  MdVisibility,
} from "react-icons/md";
import ResizeHandle from "@/components/layout/ResizeHandle";
import MarkdownRenderer from "@/components/markdown/MarkdownRenderer";
import NoteEditorToolbarStatus from "@/components/note-editor/NoteEditorToolbarStatus";
import NoteMarkdownEditor, {
  type NoteMarkdownEditorHandle,
} from "@/components/note-editor/NoteMarkdownEditor";
import NoteMarkdownToolbar from "@/components/note-editor/NoteMarkdownToolbar";
import NoteOutline from "@/components/note-editor/NoteOutline";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import { useTheme } from "@/context/ThemeContext";
import { useNoteDocument } from "@/hooks/useNoteDocument";
import { toggleMarkdownTaskAtIndex } from "@/lib/markdownTaskList";
import {
  extractNoteOutline,
  type NoteOutlineItem,
  resolveActiveOutlineLine,
} from "@/lib/noteOutline";
import {
  getEditorTopLine,
  getPreviewTopSourceLine,
  scrollEditorToLine,
  scrollPreviewToSourceLine,
} from "@/lib/noteScrollSync";
import { noteColorsToCssVars } from "@/lib/prismTheme";
import { cn } from "@/lib/utils";

export type NoteViewMode = "edit" | "split" | "preview";

const MIN_SPLIT_RATIO = 0.25;
const MAX_SPLIT_RATIO = 0.75;
const MIN_OUTLINE_WIDTH = 140;
const MAX_OUTLINE_WIDTH = 420;
const DEFAULT_OUTLINE_WIDTH = 180;

interface NoteEditorPanelProps {
  noteId: string;
  tabId?: string;
}

export default function NoteEditorPanel({ noteId, tabId }: NoteEditorPanelProps) {
  const { t } = useTranslation();
  const { appSettings, updateTab, updateUi } = useApp();
  const { noteTheme } = useTheme();
  const colors = noteTheme.colors.notes;
  const noteThemeVars = noteColorsToCssVars(colors);
  const editorRef = useRef<NoteMarkdownEditorHandle>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const syncingScrollRef = useRef(false);
  const [viewMode, setViewMode] = useState<NoteViewMode>("edit");
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [editorKey, setEditorKey] = useState(0);
  const [activeOutlineLine, setActiveOutlineLine] = useState<number | null>(null);
  const showOutline = appSettings.ui.show_note_outline ?? false;
  const outlineWidth = Math.min(
    MAX_OUTLINE_WIDTH,
    Math.max(MIN_OUTLINE_WIDTH, appSettings.ui.note_outline_width ?? DEFAULT_OUTLINE_WIDTH),
  );
  const showEditorRef = useRef(true);
  showEditorRef.current = viewMode === "edit" || viewMode === "split";

  const syncTitle = useCallback(
    (nextTitle: string) => {
      if (!tabId) return;
      const title = nextTitle.trim() || t("notes.untitled");
      void updateTab(tabId, { customName: title });
    },
    [t, tabId, updateTab],
  );

  const onMarkdownApplied = useCallback((nextMarkdown: string) => {
    editorRef.current?.setMarkdown(nextMarkdown);
  }, []);

  const {
    note,
    title,
    markdown,
    status,
    statusLabels,
    error,
    loading,
    conflictOpen,
    setConflictOpen,
    deleted,
    loadNote,
    flushSave,
    handleMarkdownChange,
    handleTitleChange,
    saveCopy,
  } = useNoteDocument({
    noteId,
    onTitleChange: syncTitle,
    onMarkdownApplied,
  });

  const handleSplitResize = useCallback((delta: number) => {
    const width = splitContainerRef.current?.clientWidth ?? 0;
    if (width <= 0) return;
    setSplitRatio((current) =>
      Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, current + delta / width)),
    );
  }, []);

  const handleOutlineResize = useCallback(
    (delta: number) => {
      updateUi((prev) => {
        const current = prev.note_outline_width ?? DEFAULT_OUTLINE_WIDTH;
        const next = Math.min(MAX_OUTLINE_WIDTH, Math.max(MIN_OUTLINE_WIDTH, current + delta));
        if (next === current) return {};
        return { note_outline_width: next };
      });
    },
    [updateUi],
  );

  const handleTaskToggle = useCallback(
    (index: number, checked: boolean) => {
      const next = toggleMarkdownTaskAtIndex(markdown, index, checked);
      if (next === markdown) return;
      handleMarkdownChange(next);
      editorRef.current?.setMarkdown(next);
    },
    [handleMarkdownChange, markdown],
  );

  const reloadNote = useCallback(() => {
    void loadNote(true).then(() => setEditorKey((key) => key + 1));
  }, [loadNote]);

  const outlineItems = useMemo(() => extractNoteOutline(markdown), [markdown]);

  const refreshActiveOutline = useCallback(() => {
    if (!showOutline || outlineItems.length === 0) {
      setActiveOutlineLine(null);
      return;
    }
    let line: number | null = null;
    if (showEditorRef.current) {
      const view = editorRef.current?.getView();
      if (view) line = getEditorTopLine(view);
    } else if (previewScrollRef.current) {
      line = getPreviewTopSourceLine(previewScrollRef.current);
    }
    setActiveOutlineLine(resolveActiveOutlineLine(outlineItems, line));
  }, [outlineItems, showOutline]);

  const handleOutlineSelect = useCallback(
    (item: NoteOutlineItem) => {
      setActiveOutlineLine(item.line);
      const view = editorRef.current?.getView();
      if (view && (viewMode === "edit" || viewMode === "split")) {
        scrollEditorToLine(view, item.line);
      }
      if (previewScrollRef.current && (viewMode === "preview" || viewMode === "split")) {
        scrollPreviewToSourceLine(previewScrollRef.current, item.line);
      }
    },
    [viewMode],
  );

  // Line-mapped scroll sync so editor/preview stay on the same source section.
  useEffect(() => {
    if (viewMode !== "split" || !note) return;
    if (editorKey < 0) return;

    const view = editorRef.current?.getView();
    const preview = previewScrollRef.current;
    if (!view || !preview) return;

    const editorScroller = view.scrollDOM;

    const fromEditor = () => {
      if (syncingScrollRef.current) return;
      syncingScrollRef.current = true;
      const line = getEditorTopLine(view);
      scrollPreviewToSourceLine(preview, line);
      if (showOutline) {
        setActiveOutlineLine(resolveActiveOutlineLine(outlineItems, line));
      }
      requestAnimationFrame(() => {
        syncingScrollRef.current = false;
      });
    };

    const fromPreview = () => {
      if (syncingScrollRef.current) return;
      const line = getPreviewTopSourceLine(preview);
      if (line == null) return;
      syncingScrollRef.current = true;
      scrollEditorToLine(view, line);
      if (showOutline) {
        setActiveOutlineLine(resolveActiveOutlineLine(outlineItems, line));
      }
      requestAnimationFrame(() => {
        syncingScrollRef.current = false;
      });
    };

    editorScroller.addEventListener("scroll", fromEditor, { passive: true });
    preview.addEventListener("scroll", fromPreview, { passive: true });
    return () => {
      editorScroller.removeEventListener("scroll", fromEditor);
      preview.removeEventListener("scroll", fromPreview);
    };
  }, [viewMode, note, editorKey, showOutline, outlineItems]);

  // Outline active heading when not in split sync (edit-only / preview-only).
  useEffect(() => {
    if (editorKey < 0) return;
    if (!showOutline || !note || viewMode === "split") {
      if (!showOutline) setActiveOutlineLine(null);
      return;
    }

    refreshActiveOutline();

    if (viewMode === "edit") {
      const view = editorRef.current?.getView();
      const scroller = view?.scrollDOM;
      if (!scroller) return;
      const onScroll = () => refreshActiveOutline();
      scroller.addEventListener("scroll", onScroll, { passive: true });
      return () => scroller.removeEventListener("scroll", onScroll);
    }

    const preview = previewScrollRef.current;
    if (!preview) return;
    const onScroll = () => refreshActiveOutline();
    preview.addEventListener("scroll", onScroll, { passive: true });
    return () => preview.removeEventListener("scroll", onScroll);
  }, [showOutline, note, viewMode, editorKey, refreshActiveOutline]);

  const modeButtons: { mode: NoteViewMode; icon: typeof MdEditNote; label: string }[] = [
    { mode: "edit", icon: MdEditNote, label: t("notes.modeEdit") },
    { mode: "split", icon: MdVerticalSplit, label: t("notes.modeSplit") },
    { mode: "preview", icon: MdVisibility, label: t("notes.modePreview") },
  ];

  if (deleted) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <MdNotes className="text-3xl text-muted-foreground" />
        <div className="text-base font-medium">{t("notes.deletedTitle")}</div>
        <div className="max-w-md text-sm text-muted-foreground">
          {t("notes.deletedDescription")}
        </div>
        <Button onClick={() => void saveCopy()}>{t("notes.saveCopy")}</Button>
      </div>
    );
  }

  const showEditor = viewMode === "edit" || viewMode === "split";
  const showPreview = viewMode === "preview" || viewMode === "split";

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden"
      style={{
        ...noteThemeVars,
        backgroundColor: colors.bgPanel,
        color: colors.text,
      }}
    >
      <div
        className="flex min-h-0 shrink-0 flex-col"
        style={{
          backgroundColor: colors.bgPanel,
          borderBottom: "1px solid var(--df-divider, var(--df-border))",
        }}
      >
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ borderBottom: "1px solid var(--df-divider, var(--df-border))" }}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            title={showOutline ? t("notes.hideOutline") : t("notes.showOutline")}
            aria-label={showOutline ? t("notes.hideOutline") : t("notes.showOutline")}
            aria-pressed={showOutline}
            onClick={() => updateUi({ show_note_outline: !showOutline })}
            style={
              showOutline
                ? {
                    backgroundColor: `${colors.primary}26`,
                    color: colors.primary,
                  }
                : {
                    color: colors.textMuted,
                  }
            }
          >
            <MdFormatListBulleted />
          </Button>
          <input
            value={title}
            onChange={(event) => handleTitleChange(event.target.value)}
            onBlur={() => void flushSave()}
            className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
            style={{ color: colors.text }}
            placeholder={t("notes.untitled")}
          />
          <NoteEditorToolbarStatus status={status} labels={statusLabels} />
          <div
            className="flex items-center rounded-md border p-0.5"
            style={{ borderColor: colors.border }}
          >
            {modeButtons.map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={viewMode === mode}
                onClick={() => setViewMode(mode)}
                className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] transition-colors"
                style={
                  viewMode === mode
                    ? {
                        backgroundColor: `${colors.primary}26`,
                        color: colors.primary,
                      }
                    : {
                        color: colors.textMuted,
                      }
                }
              >
                <Icon className="size-3.5" />
                <span className="hidden xl:inline">{label}</span>
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={reloadNote}>
            <MdRefresh />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => void flushSave()}>
            <MdSave />
          </Button>
        </div>
        {showEditor ? (
          <NoteMarkdownToolbar getView={() => editorRef.current?.getView() ?? null} />
        ) : null}
      </div>

      {error ? (
        <div
          className="border-b px-3 py-2 text-xs"
          style={{
            borderColor: `${colors.danger}59`,
            backgroundColor: `${colors.danger}1f`,
            color: colors.danger,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading && !note ? (
        <div
          className="flex flex-1 items-center justify-center text-sm"
          style={{ color: colors.textMuted }}
        >
          {t("common.loading")}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {showOutline ? (
            <>
              <NoteOutline
                items={outlineItems}
                activeLine={activeOutlineLine}
                onSelect={handleOutlineSelect}
                style={{ width: outlineWidth }}
              />
              <ResizeHandle
                direction="horizontal"
                onResize={handleOutlineResize}
                className="nyaterm-note-region-handle"
              />
            </>
          ) : null}

          <div
            ref={splitContainerRef}
            className="nyaterm-note-editor-shell flex min-h-0 min-w-0 flex-1 overflow-hidden"
            onBlur={() => {
              if (showEditor) void flushSave();
            }}
          >
            <div
              className={cn(
                "min-h-0 min-w-0 overflow-hidden",
                viewMode === "edit" && "flex-1",
                viewMode === "preview" && "hidden",
                viewMode === "split" && "nyaterm-note-split-editor",
              )}
              style={viewMode === "split" ? { width: `${splitRatio * 100}%` } : undefined}
            >
              {note ? (
                <NoteMarkdownEditor
                  key={`${noteId}-${editorKey}-${noteTheme.id}-fixed-lines`}
                  ref={editorRef}
                  initialMarkdown={markdown}
                  onChange={handleMarkdownChange}
                />
              ) : null}
            </div>

            {viewMode === "split" ? (
              <ResizeHandle
                direction="horizontal"
                onResize={handleSplitResize}
                className="nyaterm-note-region-handle"
              />
            ) : null}

            {showPreview ? (
              <div
                ref={previewScrollRef}
                className={cn(
                  "terminal-scroll min-h-0 min-w-0 overflow-auto",
                  viewMode === "split" ? "" : "flex-1",
                )}
                style={
                  viewMode === "split"
                    ? {
                        width: `${(1 - splitRatio) * 100}%`,
                        borderLeft: "1px solid var(--df-divider, var(--df-border))",
                      }
                    : undefined
                }
              >
                <MarkdownRenderer
                  content={markdown}
                  colors={colors}
                  onTaskToggle={handleTaskToggle}
                  className="h-auto min-h-full min-w-full overflow-visible"
                />
              </div>
            ) : null}
          </div>
        </div>
      )}

      <AlertDialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("notes.revisionConflict")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("notes.revisionConflictDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="outline" onClick={reloadNote}>
              {t("notes.reload")}
            </AlertDialogAction>
            <AlertDialogAction variant="outline" onClick={() => void saveCopy()}>
              {t("notes.saveCopy")}
            </AlertDialogAction>
            <AlertDialogAction onClick={() => void flushSave(true)}>
              {t("notes.overwrite")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
