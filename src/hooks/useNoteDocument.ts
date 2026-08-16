import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { NoteSaveStatus } from "@/components/note-editor/NoteEditorToolbarStatus";
import { getErrorMessage } from "@/lib/errors";
import { invoke } from "@/lib/invoke";
import { logger } from "@/lib/logger";
import { openNoteInWorkspace } from "@/lib/noteEditorEvents";
import { listenNotesChanged } from "@/lib/noteEvents";
import type { NoteDocument } from "@/types/notes";

const AUTOSAVE_DEBOUNCE_MS = 800;

export interface UseNoteDocumentOptions {
  noteId: string | null;
  onTitleChange?: (title: string) => void;
  /** Called when markdown is applied from an external reload (e.g. set editor content). */
  onMarkdownApplied?: (markdown: string) => void;
}

export function useNoteDocument({
  noteId,
  onTitleChange,
  onMarkdownApplied,
}: UseNoteDocumentOptions) {
  const { t } = useTranslation();
  const latestMarkdownRef = useRef("");
  const latestTitleRef = useRef("");
  const revisionRef = useRef(0);
  const parentIdRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const savingPromiseRef = useRef<Promise<boolean> | null>(null);
  const performSaveRef = useRef<(force?: boolean) => Promise<boolean>>(async () => false);
  const debounceRef = useRef<number | null>(null);
  const deletedRef = useRef(false);
  const suppressChangeRef = useRef(false);

  const [note, setNote] = useState<NoteDocument | null>(null);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [status, setStatus] = useState<NoteSaveStatus>("saved");
  const [error, setError] = useState("");
  const [conflictOpen, setConflictOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const statusLabels = {
    saved: t("notes.saved"),
    saving: t("notes.saving"),
    unsaved: t("notes.unsaved"),
    failed: t("notes.saveFailed"),
    external: t("notes.externalUpdate"),
    deleted: t("notes.deletedStatus"),
  };

  const applyLoadedNote = useCallback(
    (next: NoteDocument, applyToEditor = true) => {
      latestTitleRef.current = next.title;
      latestMarkdownRef.current = next.markdown;
      revisionRef.current = next.revision;
      parentIdRef.current = next.parent_id ?? null;
      dirtyRef.current = false;
      deletedRef.current = false;
      setDeleted(false);
      setNote(next);
      setTitle(next.title);
      setMarkdown(next.markdown);
      onTitleChange?.(next.title);
      setStatus("saved");
      setError("");
      if (applyToEditor) {
        suppressChangeRef.current = true;
        onMarkdownApplied?.(next.markdown);
        window.setTimeout(() => {
          suppressChangeRef.current = false;
        }, 0);
      }
    },
    [onMarkdownApplied, onTitleChange],
  );

  const loadNote = useCallback(
    async (applyToEditor = true) => {
      if (!noteId) return;
      setLoading(true);
      try {
        const next = await invoke<NoteDocument>("get_note", { noteId });
        applyLoadedNote(next, applyToEditor);
      } catch (err) {
        setError(getErrorMessage(err));
        setStatus("failed");
      } finally {
        setLoading(false);
      }
    },
    [applyLoadedNote, noteId],
  );

  useEffect(() => {
    if (!noteId) {
      setNote(null);
      setTitle("");
      setMarkdown("");
      setError("");
      setStatus("saved");
      deletedRef.current = false;
      setDeleted(false);
      dirtyRef.current = false;
      return;
    }
    void loadNote(true);
  }, [loadNote, noteId]);

  const markDirty = useCallback(() => {
    if (deletedRef.current) return;
    dirtyRef.current = true;
    setStatus("unsaved");
  }, []);

  const performSave = useCallback(
    async (force = false) => {
      if (!noteId || deletedRef.current) return false;
      if (!dirtyRef.current && !force) return true;
      if (savingPromiseRef.current) {
        await savingPromiseRef.current;
        if (!dirtyRef.current && !force) return true;
        return performSaveRef.current(force);
      }

      const nextMarkdown = latestMarkdownRef.current;
      const nextTitle = latestTitleRef.current.trim() || t("notes.untitled");
      const expectedRevision = revisionRef.current;
      dirtyRef.current = false;
      setStatus("saving");
      const promise = invoke<NoteDocument>("update_note", {
        noteId,
        title: nextTitle,
        markdown: nextMarkdown,
        expectedRevision,
        force,
      })
        .then((saved) => {
          revisionRef.current = saved.revision;
          parentIdRef.current = saved.parent_id ?? null;
          if (
            latestMarkdownRef.current === nextMarkdown &&
            latestTitleRef.current.trim() === nextTitle
          ) {
            setNote(saved);
            setTitle(saved.title);
            setMarkdown(saved.markdown);
            latestTitleRef.current = saved.title;
            latestMarkdownRef.current = saved.markdown;
            onTitleChange?.(saved.title);
            setStatus("saved");
          } else {
            setNote((current) =>
              current
                ? {
                    ...saved,
                    title: latestTitleRef.current,
                    markdown: latestMarkdownRef.current,
                  }
                : saved,
            );
            dirtyRef.current = true;
            setStatus("unsaved");
            window.setTimeout(() => {
              void performSaveRef.current();
            }, 0);
          }
          setError("");
          return true;
        })
        .catch((err) => {
          dirtyRef.current = true;
          const message = getErrorMessage(err);
          setError(message);
          if (message.toLowerCase().includes("revision conflict")) {
            setConflictOpen(true);
            setStatus("external");
          } else {
            setStatus("failed");
          }
          logger.error({
            domain: "ui.error",
            event: "note.save_failed",
            message: "Failed to save note",
            error: err,
          });
          return false;
        })
        .finally(() => {
          savingPromiseRef.current = null;
        });
      savingPromiseRef.current = promise;
      return promise;
    },
    [noteId, onTitleChange, t],
  );
  performSaveRef.current = performSave;

  const scheduleSave = useCallback(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void performSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [performSave]);

  const flushSave = useCallback(
    async (force = false) => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      return performSave(force);
    },
    [performSave],
  );

  const handleMarkdownChange = useCallback(
    (value: string) => {
      if (suppressChangeRef.current) return;
      latestMarkdownRef.current = value;
      setMarkdown(value);
      markDirty();
      scheduleSave();
    },
    [markDirty, scheduleSave],
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      setTitle(value);
      onTitleChange?.(value);
      latestTitleRef.current = value;
      markDirty();
      scheduleSave();
    },
    [markDirty, onTitleChange, scheduleSave],
  );

  useEffect(() => {
    if (!noteId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flushSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flushSave, noteId]);

  useEffect(() => {
    if (!noteId) return;
    let unlisten: (() => void) | undefined;
    listenNotesChanged((event) => {
      if (!event.ids.includes(noteId) && event.kind !== "replaced") return;
      if (event.kind === "deleted") {
        deletedRef.current = true;
        dirtyRef.current = false;
        setDeleted(true);
        setStatus("deleted");
        return;
      }
      if (event.kind === "updated" && savingPromiseRef.current) return;
      if (event.kind === "updated" && revisionRef.current && !dirtyRef.current) {
        void loadNote(true);
        return;
      }
      if (dirtyRef.current) {
        setStatus("external");
        setConflictOpen(true);
      } else {
        void loadNote(true);
      }
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, [loadNote, noteId]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, []);

  const saveCopy = useCallback(async () => {
    try {
      const created = await invoke<NoteDocument>("create_note", {
        parentId: parentIdRef.current,
        title: `${latestTitleRef.current || t("notes.untitled")} ${t("notes.conflictCopySuffix")}`,
        markdown: latestMarkdownRef.current,
      });
      dirtyRef.current = false;
      setConflictOpen(false);
      toast.success(t("notes.copySaved"));
      openNoteInWorkspace(created.id, created.title);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [t]);

  return {
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
    latestMarkdownRef,
  };
}
