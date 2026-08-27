import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { NoteSaveStatus } from "@/components/note-editor/NoteEditorToolbarStatus";
import { useEncryptedNotesSession } from "@/hooks/useEncryptedNotesSession";
import { getErrorMessage } from "@/lib/errors";
import { invoke } from "@/lib/invoke";
import { logger } from "@/lib/logger";
import { localizeNotePasswordError } from "@/lib/notePasswordErrors";
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
  const { unlockFolder } = useEncryptedNotesSession();
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
  const passwordRef = useRef<string | null>(null);
  const encryptedRef = useRef(false);

  const [note, setNote] = useState<NoteDocument | null>(null);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [status, setStatus] = useState<NoteSaveStatus>("saved");
  const [error, setError] = useState("");
  const [conflictOpen, setConflictOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  const statusLabels = {
    saved: t("notes.saved"),
    saving: t("notes.saving"),
    unsaved: t("notes.unsaved"),
    failed: t("notes.saveFailed"),
    external: t("notes.externalUpdate"),
    deleted: t("notes.deletedStatus"),
  };

  const clearSessionSecrets = useCallback(() => {
    passwordRef.current = null;
    encryptedRef.current = false;
    setNeedsPassword(false);
    setUnlockError("");
    setUnlocked(false);
  }, []);

  const applyLoadedNote = useCallback(
    (next: NoteDocument, applyToEditor = true) => {
      latestTitleRef.current = next.title;
      latestMarkdownRef.current = next.markdown;
      revisionRef.current = next.revision;
      parentIdRef.current = next.parent_id ?? null;
      dirtyRef.current = false;
      deletedRef.current = false;
      encryptedRef.current = Boolean(next.encrypted);
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
      setUnlockError("");
      try {
        const next = await invoke<NoteDocument>("get_note", { noteId });
        if (next.encrypted) {
          // Always require password when opening an encrypted note in the editor.
          // Folder-session unlock is only for tree browsing; closing a note tab
          // must not leave content readable on the next open.
          passwordRef.current = null;
          encryptedRef.current = true;
          setUnlocked(false);
          setNeedsPassword(true);
          setNote({ ...next, markdown: "" });
          setTitle(next.title);
          setMarkdown("");
          latestTitleRef.current = next.title;
          latestMarkdownRef.current = "";
          revisionRef.current = next.revision;
          parentIdRef.current = next.parent_id ?? null;
          onTitleChange?.(next.title);
          setStatus("saved");
          setError("");
          if (applyToEditor) {
            suppressChangeRef.current = true;
            onMarkdownApplied?.("");
            window.setTimeout(() => {
              suppressChangeRef.current = false;
            }, 0);
          }
          return;
        }
        clearSessionSecrets();
        applyLoadedNote(next, applyToEditor);
        setUnlocked(true);
      } catch (err) {
        setError(getErrorMessage(err));
        setStatus("failed");
      } finally {
        setLoading(false);
      }
    },
    [applyLoadedNote, clearSessionSecrets, noteId, onMarkdownApplied, onTitleChange],
  );

  const unlockWithPassword = useCallback(
    async (password: string) => {
      if (!noteId || unlocking) return false;
      setUnlocking(true);
      setUnlockError("");
      try {
        const unlockedNote = await invoke<NoteDocument>("unlock_note", {
          noteId,
          password,
        });
        passwordRef.current = password;
        encryptedRef.current = true;
        setNeedsPassword(false);
        setUnlocked(true);
        const rootFolderId =
          unlockedNote.encryption?.root_folder_id ?? unlockedNote.root_folder_id ?? null;
        if (rootFolderId) {
          unlockFolder(rootFolderId, password);
        }
        applyLoadedNote(unlockedNote, true);
        return true;
      } catch (err) {
        setUnlockError(localizeNotePasswordError(err, t));
        return false;
      } finally {
        setUnlocking(false);
      }
    },
    [applyLoadedNote, noteId, t, unlockFolder, unlocking],
  );

  useEffect(() => {
    clearSessionSecrets();
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
    return () => {
      // Closing the tab clears in-memory password (plan requirement).
      passwordRef.current = null;
    };
  }, [clearSessionSecrets, loadNote, noteId]);

  const markDirty = useCallback(() => {
    if (deletedRef.current || needsPassword) return;
    dirtyRef.current = true;
    setStatus("unsaved");
  }, [needsPassword]);

  const performSave = useCallback(
    async (force = false) => {
      if (!noteId || deletedRef.current || needsPassword) return false;
      if (!dirtyRef.current && !force) return true;
      if (encryptedRef.current && !passwordRef.current) {
        setNeedsPassword(true);
        setStatus("failed");
        setError(t("notes.password.required"));
        return false;
      }
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
        password: passwordRef.current ?? undefined,
      })
        .then((saved) => {
          revisionRef.current = saved.revision;
          parentIdRef.current = saved.parent_id ?? null;
          encryptedRef.current = Boolean(saved.encrypted);
          // Keep plaintext in memory for encrypted notes after save.
          const displayMarkdown = nextMarkdown;
          if (
            latestMarkdownRef.current === nextMarkdown &&
            latestTitleRef.current.trim() === nextTitle
          ) {
            setNote({ ...saved, markdown: displayMarkdown });
            setTitle(saved.title);
            setMarkdown(displayMarkdown);
            latestTitleRef.current = saved.title;
            latestMarkdownRef.current = displayMarkdown;
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
                : { ...saved, markdown: displayMarkdown },
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
    [needsPassword, noteId, onTitleChange, t],
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
      if (suppressChangeRef.current || needsPassword) return;
      latestMarkdownRef.current = value;
      setMarkdown(value);
      markDirty();
      scheduleSave();
    },
    [markDirty, needsPassword, scheduleSave],
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      if (needsPassword) return;
      setTitle(value);
      onTitleChange?.(value);
      latestTitleRef.current = value;
      markDirty();
      scheduleSave();
    },
    [markDirty, needsPassword, onTitleChange, scheduleSave],
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
      // Encrypted notes: external updates require re-unlock.
      if (encryptedRef.current) {
        passwordRef.current = null;
        setUnlocked(false);
        setNeedsPassword(true);
        void loadNote(true);
        return;
      }
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
      passwordRef.current = null;
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
    needsPassword,
    unlockError,
    unlocking,
    unlocked,
    unlockWithPassword,
    loadNote,
    flushSave,
    handleMarkdownChange,
    handleTitleChange,
    saveCopy,
    latestMarkdownRef,
  };
}
