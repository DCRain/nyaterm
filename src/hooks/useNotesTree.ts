import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/context/AppContext";
import { getErrorMessage } from "@/lib/errors";
import { invoke } from "@/lib/invoke";
import { logger } from "@/lib/logger";
import { listenNotesChanged } from "@/lib/noteEvents";
import type {
  DeleteNoteNodeResult,
  NoteDocument,
  NoteFolder,
  NoteNodeKind,
  NoteSummary,
  NoteTreePayload,
} from "@/types/notes";

function upsertFolders(current: NoteFolder[], incoming: NoteFolder[]) {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((folder) => [folder.id, folder]));
  let changed = false;
  for (const folder of incoming) {
    const previous = byId.get(folder.id);
    if (previous !== folder) {
      byId.set(folder.id, folder);
      changed = true;
    }
  }
  return changed ? Array.from(byId.values()) : current;
}

function upsertNotes(current: NoteSummary[], incoming: NoteSummary[]) {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((note) => [note.id, note]));
  let changed = false;
  for (const note of incoming) {
    const previous = byId.get(note.id);
    if (
      !previous ||
      previous.parent_id !== note.parent_id ||
      previous.title !== note.title ||
      previous.sort_order !== note.sort_order ||
      previous.revision !== note.revision ||
      previous.updated_at_ms !== note.updated_at_ms
    ) {
      byId.set(note.id, note);
      changed = true;
    }
  }
  return changed ? Array.from(byId.values()) : current;
}

export function useNotesTree() {
  const { appSettings, updateUi } = useApp();
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedNodeId = appSettings.ui.notes_last_selected_node_id ?? null;
  const expandedFolderIds = useMemo(
    () => new Set(appSettings.ui.notes_expanded_folder_ids ?? []),
    [appSettings.ui.notes_expanded_folder_ids],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await invoke<NoteTreePayload>("list_note_tree");
      setFolders(payload.folders);
      setNotes(payload.notes);
      setError(null);
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      logger.error({
        domain: "ui.error",
        event: "notes.tree.load_failed",
        message: "Failed to load notes",
        error: err,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listenNotesChanged((event) => {
      if (disposed) return;
      if (event.kind === "replaced") {
        void refresh();
        return;
      }
      if (event.kind === "deleted") {
        const ids = new Set(event.ids);
        setFolders((current) => current.filter((folder) => !ids.has(folder.id)));
        setNotes((current) => current.filter((note) => !ids.has(note.id)));
        return;
      }
      if (event.kind === "updated" && event.treeChanged === false) return;
      if ((event.folders?.length ?? 0) > 0) {
        setFolders((current) => upsertFolders(current, event.folders ?? []));
      }
      if ((event.notes?.length ?? 0) > 0) {
        setNotes((current) => upsertNotes(current, event.notes ?? []));
      }
      if ((event.folders?.length ?? 0) === 0 && (event.notes?.length ?? 0) === 0) {
        void refresh();
      }
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch((err) => {
        logger.warn({
          domain: "ui.error",
          event: "notes.event.listen_failed",
          message: "Failed to listen for notes changes",
          error: err,
        });
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refresh]);

  const setSelectedNodeId = useCallback(
    (id: string | null) => updateUi({ notes_last_selected_node_id: id }),
    [updateUi],
  );

  const setExpandedFolderIds = useCallback(
    (ids: Set<string>) => updateUi({ notes_expanded_folder_ids: Array.from(ids) }),
    [updateUi],
  );

  const createFolder = useCallback(
    async (parentId: string | null, name?: string) => {
      const folder = await invoke<NoteFolder>("create_note_folder", { parentId, name });
      setFolders((current) => upsertFolders(current, [folder]));
      setSelectedNodeId(folder.id);
      setExpandedFolderIds(new Set([...expandedFolderIds, ...(parentId ? [parentId] : [])]));
      return folder;
    },
    [expandedFolderIds, setExpandedFolderIds, setSelectedNodeId],
  );

  const createNote = useCallback(
    async (parentId: string | null, title?: string, markdown?: string, password?: string) => {
      const note = await invoke<NoteDocument>("create_note", {
        parentId,
        title,
        markdown,
        password,
      });
      setNotes((current) =>
        upsertNotes(current, [
          {
            id: note.id,
            parent_id: note.parent_id,
            title: note.title,
            sort_order: note.sort_order,
            revision: note.revision,
            created_at_ms: note.created_at_ms,
            updated_at_ms: note.updated_at_ms,
            encrypted: note.encrypted,
            root_folder_id: note.root_folder_id ?? note.encryption?.root_folder_id ?? null,
          },
        ]),
      );
      setSelectedNodeId(note.id);
      setExpandedFolderIds(new Set([...expandedFolderIds, ...(parentId ? [parentId] : [])]));
      return note;
    },
    [expandedFolderIds, setExpandedFolderIds, setSelectedNodeId],
  );

  const renameNode = useCallback(async (nodeKind: NoteNodeKind, nodeId: string, name: string) => {
    await invoke("rename_note_node", { nodeKind, nodeId, name });
  }, []);

  const moveNode = useCallback(
    async (
      nodeKind: NoteNodeKind,
      nodeId: string,
      parentId: string | null,
      sortOrder: number,
      options?: {
        encryptionAction?: "plain" | "keep" | "decrypt" | "rebind" | null;
        sourcePassword?: string | null;
        targetPassword?: string | null;
      },
    ) => {
      await invoke("move_note_node", {
        nodeKind,
        nodeId,
        parentId,
        sortOrder,
        encryptionAction: options?.encryptionAction ?? null,
        sourcePassword: options?.sourcePassword ?? null,
        targetPassword: options?.targetPassword ?? null,
      });
      if (parentId) setExpandedFolderIds(new Set([...expandedFolderIds, parentId]));
    },
    [expandedFolderIds, setExpandedFolderIds],
  );

  const deleteNode = useCallback(
    async (nodeKind: NoteNodeKind, nodeId: string) => {
      const result = await invoke<DeleteNoteNodeResult>("delete_note_node", { nodeKind, nodeId });
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      const ids = new Set(result.ids);
      setFolders((current) => current.filter((folder) => !ids.has(folder.id)));
      setNotes((current) => current.filter((note) => !ids.has(note.id)));
      return result;
    },
    [selectedNodeId, setSelectedNodeId],
  );

  const runAction = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (err) {
      toast.error(getErrorMessage(err));
      logger.error({
        domain: "ui.error",
        event: "notes.action.failed",
        message: "Notes action failed",
        error: err,
      });
    }
  }, []);

  return {
    folders,
    notes,
    loading,
    error,
    refresh,
    selectedNodeId,
    setSelectedNodeId,
    expandedFolderIds,
    setExpandedFolderIds,
    createFolder,
    createNote,
    renameNode,
    moveNode,
    deleteNode,
    runAction,
  };
}
