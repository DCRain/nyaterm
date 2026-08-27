import {
  type DragEvent,
  type KeyboardEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { MdAdd, MdCreateNewFolder, MdDescription } from "react-icons/md";
import { toast } from "sonner";
import NotePasswordDialog, {
  type NotePasswordMode,
} from "@/components/dialog/note-editor/NotePasswordDialog";
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
import { useEncryptedNotesSession } from "@/hooks/useEncryptedNotesSession";
import { useNotesTree } from "@/hooks/useNotesTree";
import { invoke } from "@/lib/invoke";
import { openNoteInWorkspace } from "@/lib/noteEditorEvents";
import { localizeNotePasswordError } from "@/lib/notePasswordErrors";
import { collectSessionPanes } from "@/lib/workspaceTabs";
import type { NoteFolder, NoteTreeNode } from "@/types/notes";
import MoveOutChoiceDialog, { type MoveOutChoice } from "./MoveOutChoiceDialog";
import NotesPanelHeader from "./NotesPanelHeader";
import NoteTree from "./NoteTree";
import {
  buildNoteTree,
  collectDescendantFolderIds,
  collectNoteIdsInFolderTree,
  collectSiblingNames,
  filterNoteTree,
  findNoteNode,
  flattenNoteFolders,
  flattenVisibleNoteTree,
  isDescendantFolder,
  validateNoteInputName,
} from "./noteTreeUtils";

function countFolderContents(node: NoteTreeNode) {
  let folders = 0;
  let notes = 0;
  const visit = (item: NoteTreeNode) => {
    for (const child of item.children) {
      if (child.kind === "folder") folders += 1;
      else notes += 1;
      visit(child);
    }
  };
  visit(node);
  return { folders, notes };
}

function encryptionRootId(node: NoteTreeNode): string {
  return node.rootFolderId || node.id;
}

/** Encryption root of the destination parent folder, or null if outside any encrypted tree. */
function encryptionRootForParent(folders: NoteFolder[], parentId: string | null): string | null {
  if (!parentId) return null;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = byId.get(parentId);
  while (current) {
    if (current.encrypted) {
      return current.encryption?.root_folder_id || current.id;
    }
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return null;
}

/** Folder-bound encryption root for a node; null if plaintext or standalone-encrypted. */
function sourceBoundEncryptionRoot(node: NoteTreeNode): string | null {
  if (!node.encrypted) return null;
  if (node.kind === "folder") {
    return node.rootFolderId || node.id;
  }
  return node.rootFolderId ?? null;
}

function isStandaloneEncrypted(node: NoteTreeNode): boolean {
  return Boolean(node.encrypted && node.kind === "note" && !node.rootFolderId);
}

/** True if this node or any descendant is encrypted (needs password to delete). */
function nodeRequiresDeletePassword(node: NoteTreeNode): boolean {
  if (node.encrypted) return true;
  return node.children.some(nodeRequiresDeletePassword);
}

type MoveOutPending = {
  node: NoteTreeNode;
  parentId: string | null;
  sourceRootId: string;
};

type PasswordAction =
  | { kind: "unlock-folder"; node: NoteTreeNode; expandAfter: boolean }
  | { kind: "encrypt"; node: NoteTreeNode }
  | { kind: "decrypt"; node: NoteTreeNode }
  | { kind: "change"; node: NoteTreeNode }
  | { kind: "delete"; node: NoteTreeNode }
  | { kind: "create-note"; parentId: string }
  | {
      kind: "move-out";
      node: NoteTreeNode;
      parentId: string | null;
      action: MoveOutChoice;
      sourceRootId: string;
    }
  | {
      kind: "move-rebind";
      node: NoteTreeNode;
      parentId: string | null;
      sourceRootId: string | null;
      targetRootId: string;
      needsSourcePassword: boolean;
      cachedSourcePassword?: string;
    };

export default function NotesPanel() {
  const { t } = useTranslation();
  const { tabs, closeTabs } = useApp();
  const {
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
  } = useNotesTree();
  const { isFolderUnlocked, unlockFolder, lockFolder, getFolderPassword } =
    useEncryptedNotesSession();
  const [search, setSearch] = useState("");
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NoteTreeNode | null>(null);
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
  const [passwordAction, setPasswordAction] = useState<PasswordAction | null>(null);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [moveOutPending, setMoveOutPending] = useState<MoveOutPending | null>(null);
  const dragSourceRef = useRef<NoteTreeNode | null>(null);
  const deferredSearch = useDeferredValue(search);

  const tree = useMemo(() => buildNoteTree(folders, notes), [folders, notes]);
  const visibleTree = useMemo(
    () => filterNoteTree(tree, deferredSearch.trim()),
    [tree, deferredSearch],
  );
  const visibleRows = useMemo(
    () => flattenVisibleNoteTree(visibleTree, expandedFolderIds),
    [expandedFolderIds, visibleTree],
  );
  const selectedNode = useMemo(() => findNoteNode(tree, selectedNodeId), [selectedNodeId, tree]);
  const folderTargets = useMemo(() => flattenNoteFolders(tree), [tree]);

  // Locked encrypted folders stay collapsed (including after restart with persisted expand ids).
  useEffect(() => {
    const lockedIds = new Set<string>();
    for (const folder of folders) {
      if (!folder.encrypted) continue;
      const rootId = folder.encryption?.root_folder_id || folder.id;
      if (!isFolderUnlocked(rootId)) lockedIds.add(folder.id);
    }
    if (lockedIds.size === 0) return;
    let changed = false;
    const next = new Set(expandedFolderIds);
    for (const id of lockedIds) {
      if (next.delete(id)) changed = true;
    }
    if (changed) setExpandedFolderIds(next);
  }, [expandedFolderIds, folders, isFolderUnlocked, setExpandedFolderIds]);

  const labels = {
    open: t("notes.open"),
    newNote: t("notes.newNote"),
    newFolder: t("notes.newFolder"),
    rename: t("notes.rename"),
    moveTo: t("notes.moveTo"),
    delete: t("notes.delete"),
    refresh: t("common.refresh"),
    root: t("notes.root"),
    search: t("notes.search"),
    expandAll: t("notes.expandAll"),
    collapseAll: t("notes.collapseAll"),
    more: t("common.more"),
    encrypt: t("notes.encrypt"),
    decrypt: t("notes.decrypt"),
    changePassword: t("notes.changePassword"),
    encrypted: t("notes.encrypted"),
    lock: t("notes.lock"),
  };

  const creationParentId = () => {
    if (!selectedNode) return null;
    return selectedNode.kind === "folder" ? selectedNode.id : selectedNode.parentId;
  };

  const startCreateNote = (parentId = creationParentId()) => {
    if (parentId) {
      const parent = findNoteNode(tree, parentId);
      if (parent?.encrypted) {
        setPasswordError("");
        setPasswordAction({ kind: "create-note", parentId });
        return;
      }
    }
    void runAction(async () => {
      const note = await createNote(parentId);
      setEditingNodeId(note.id);
    });
  };

  const startCreateFolder = (parentId = creationParentId()) => {
    void runAction(async () => {
      const folder = await createFolder(parentId);
      setEditingNodeId(folder.id);
    });
  };

  const expandFolder = (node: NoteTreeNode) => {
    const next = new Set(expandedFolderIds);
    next.add(node.id);
    setExpandedFolderIds(next);
  };

  const toggleFolder = (node: NoteTreeNode) => {
    if (node.kind !== "folder") return;
    if (expandedFolderIds.has(node.id)) {
      const next = new Set(expandedFolderIds);
      next.delete(node.id);
      setExpandedFolderIds(next);
      return;
    }
    if (node.encrypted) {
      const rootId = encryptionRootId(node);
      if (!isFolderUnlocked(rootId)) {
        setPasswordError("");
        setPasswordAction({ kind: "unlock-folder", node, expandAfter: true });
        return;
      }
    }
    expandFolder(node);
  };

  const openNode = (node: NoteTreeNode) => {
    if (node.kind !== "note") return;
    openNoteInWorkspace(node.id, node.name);
  };

  const submitRename = (node: NoteTreeNode, name: string) => {
    const validation = validateNoteInputName(
      name,
      collectSiblingNames(folders, notes, node.parentId, { id: node.id, kind: node.kind }),
    );
    if (validation) return;
    setEditingNodeId(null);
    void runAction(() => renameNode(node.kind, node.id, name));
  };

  const executeMove = (
    node: NoteTreeNode,
    parentId: string | null,
    options?: {
      encryptionAction?: "plain" | "keep" | "decrypt" | "rebind" | null;
      sourcePassword?: string | null;
      targetPassword?: string | null;
    },
  ) => {
    void runAction(() =>
      moveNode(node.kind, node.id, parentId, Date.now(), {
        encryptionAction: options?.encryptionAction ?? null,
        sourcePassword: options?.sourcePassword ?? null,
        targetPassword: options?.targetPassword ?? null,
      }),
    );
  };

  const moveToParent = (node: NoteTreeNode, parentId: string | null) => {
    if (
      node.kind === "folder" &&
      parentId &&
      (parentId === node.id || isDescendantFolder(tree, node.id, parentId))
    ) {
      return;
    }

    const sourceRoot = sourceBoundEncryptionRoot(node);
    const targetRoot = encryptionRootForParent(folders, parentId);
    const standalone = isStandaloneEncrypted(node);

    // Same encrypted tree or both outside encryption → plain move.
    if (sourceRoot && targetRoot && sourceRoot === targetRoot) {
      executeMove(node, parentId, { encryptionAction: "plain" });
      return;
    }
    if (!sourceRoot && !standalone && !targetRoot) {
      executeMove(node, parentId, { encryptionAction: "plain" });
      return;
    }
    // Standalone encrypted note staying outside encrypted trees.
    if (standalone && !targetRoot) {
      executeMove(node, parentId, { encryptionAction: "plain" });
      return;
    }

    // Leaving an encrypted folder tree → ask keep / decrypt / cancel.
    if (sourceRoot && !targetRoot) {
      setMoveOutPending({ node, parentId, sourceRootId: sourceRoot });
      return;
    }

    // Entering / switching into an encrypted folder.
    if (targetRoot) {
      const needsSource = Boolean(sourceRoot || standalone);
      const sourcePwd = sourceRoot ? getFolderPassword(sourceRoot) : null;
      const targetPwd = getFolderPassword(targetRoot);

      if (needsSource && sourceRoot && sourcePwd && targetPwd) {
        executeMove(node, parentId, {
          encryptionAction: "rebind",
          sourcePassword: sourcePwd,
          targetPassword: targetPwd,
        });
        return;
      }
      if (!needsSource && targetPwd) {
        executeMove(node, parentId, {
          encryptionAction: "rebind",
          targetPassword: targetPwd,
        });
        return;
      }
      // Source password known from session; only need target password.
      if (needsSource && sourceRoot && sourcePwd && !targetPwd) {
        setPasswordError("");
        setPasswordAction({
          kind: "move-rebind",
          node,
          parentId,
          sourceRootId: sourceRoot,
          targetRootId: targetRoot,
          needsSourcePassword: false,
          cachedSourcePassword: sourcePwd,
        });
        return;
      }

      setPasswordError("");
      setPasswordAction({
        kind: "move-rebind",
        node,
        parentId,
        sourceRootId: sourceRoot,
        targetRootId: targetRoot,
        needsSourcePassword: needsSource,
      });
      return;
    }

    executeMove(node, parentId, { encryptionAction: "plain" });
  };

  const handleMoveOutChoice = (choice: MoveOutChoice) => {
    const pending = moveOutPending;
    if (!pending) return;
    setMoveOutPending(null);

    const isEncRoot =
      pending.node.kind === "folder" && pending.node.encrypted && !pending.node.rootFolderId;

    if (choice === "keep" && isEncRoot) {
      executeMove(pending.node, pending.parentId, { encryptionAction: "keep" });
      return;
    }

    const cached = getFolderPassword(pending.sourceRootId);
    if (cached) {
      executeMove(pending.node, pending.parentId, {
        encryptionAction: choice === "keep" ? "keep" : "decrypt",
        sourcePassword: cached,
      });
      return;
    }

    setPasswordError("");
    setPasswordAction({
      kind: "move-out",
      node: pending.node,
      parentId: pending.parentId,
      action: choice,
      sourceRootId: pending.sourceRootId,
    });
  };

  const requestDelete = (node: NoteTreeNode) => {
    if (nodeRequiresDeletePassword(node)) {
      setPasswordError("");
      setPasswordAction({ kind: "delete", node });
      return;
    }
    setDeleteTarget(node);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!selectedNode) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (selectedNode.kind === "folder") toggleFolder(selectedNode);
      else openNode(selectedNode);
    } else if (event.key === "F2") {
      event.preventDefault();
      setEditingNodeId(selectedNode.id);
    } else if (event.key === "Delete") {
      event.preventDefault();
      requestDelete(selectedNode);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = visibleRows.findIndex(({ node }) => node.id === selectedNode.id);
      const nextIndex = event.key === "ArrowDown" ? index + 1 : index - 1;
      const next = visibleRows[Math.max(0, Math.min(visibleRows.length - 1, nextIndex))]?.node;
      if (next) setSelectedNodeId(next.id);
    }
  };

  const handleDragOverNode = (event: DragEvent<HTMLDivElement>, node: NoteTreeNode) => {
    const source = dragSourceRef.current;
    if (!source || source.id === node.id) return;
    if (
      source.kind === "folder" &&
      node.kind === "folder" &&
      isDescendantFolder(tree, source.id, node.id)
    ) {
      event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverNodeId((current) => (current === node.id ? current : node.id));
  };

  const handleDropNode = (event: DragEvent<HTMLDivElement>, node: NoteTreeNode) => {
    event.preventDefault();
    const source = dragSourceRef.current;
    setDragOverNodeId(null);
    dragSourceRef.current = null;
    if (!source || source.id === node.id) return;
    const parentId = node.kind === "folder" ? node.id : node.parentId;
    moveToParent(source, parentId);
  };

  const handleDragOverRoot = (event: DragEvent<HTMLDivElement>) => {
    if (!dragSourceRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDropRoot = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const source = dragSourceRef.current;
    setDragOverNodeId(null);
    dragSourceRef.current = null;
    if (source) moveToParent(source, null);
  };

  const passwordMode: NotePasswordMode =
    passwordAction?.kind === "encrypt" || passwordAction?.kind === "create-note"
      ? passwordAction.kind === "create-note"
        ? "unlock"
        : "encrypt"
      : passwordAction?.kind === "decrypt"
        ? "decrypt"
        : passwordAction?.kind === "change"
          ? "change"
          : passwordAction?.kind === "delete"
            ? "delete"
            : passwordAction?.kind === "move-rebind" && passwordAction.needsSourcePassword
              ? "cross-move"
              : "unlock";

  const passwordTargetName =
    passwordAction && "node" in passwordAction
      ? passwordAction.node.name
      : passwordAction?.kind === "create-note"
        ? findNoteNode(tree, passwordAction.parentId)?.name || t("notes.newNote")
        : "";

  const handlePasswordSubmit = async (password: string, newPassword?: string) => {
    if (!passwordAction) return;
    setPasswordSubmitting(true);
    setPasswordError("");
    try {
      const { kind } = passwordAction;
      if (kind === "create-note") {
        const note = await createNote(passwordAction.parentId, undefined, undefined, password);
        setEditingNodeId(note.id);
        setPasswordAction(null);
        await refresh();
        return;
      }
      if (kind === "delete") {
        await deleteNode(passwordAction.node.kind, passwordAction.node.id, password);
        const clearDeletedEncryptionRoots = (node: NoteTreeNode) => {
          if (node.kind === "folder" && node.encrypted && !node.rootFolderId) {
            lockFolder(node.id);
          }
          for (const child of node.children) clearDeletedEncryptionRoots(child);
        };
        clearDeletedEncryptionRoots(passwordAction.node);
        setPasswordAction(null);
        return;
      }
      if (kind === "move-out") {
        await moveNode(
          passwordAction.node.kind,
          passwordAction.node.id,
          passwordAction.parentId,
          Date.now(),
          {
            encryptionAction: passwordAction.action === "keep" ? "keep" : "decrypt",
            sourcePassword: password,
          },
        );
        unlockFolder(passwordAction.sourceRootId, password);
        setPasswordAction(null);
        return;
      }
      if (kind === "move-rebind") {
        const sourcePassword = passwordAction.needsSourcePassword
          ? password
          : passwordAction.cachedSourcePassword || null;
        const targetPassword = passwordAction.needsSourcePassword ? newPassword || "" : password;
        if (!targetPassword) {
          setPasswordError(t("notes.password.required"));
          return;
        }
        await moveNode(
          passwordAction.node.kind,
          passwordAction.node.id,
          passwordAction.parentId,
          Date.now(),
          {
            encryptionAction: "rebind",
            sourcePassword,
            targetPassword,
          },
        );
        if (passwordAction.sourceRootId && sourcePassword) {
          unlockFolder(passwordAction.sourceRootId, sourcePassword);
        }
        unlockFolder(passwordAction.targetRootId, targetPassword);
        setPasswordAction(null);
        return;
      }
      const { node } = passwordAction;
      if (kind === "unlock-folder") {
        const rootId = encryptionRootId(node);
        const ok = await invoke<boolean>("verify_folder_password", {
          folderId: rootId,
          password,
        });
        if (!ok) {
          setPasswordError(t("notes.password.wrongPassword"));
          return;
        }
        unlockFolder(rootId, password);
        if (passwordAction.expandAfter) expandFolder(node);
        setPasswordAction(null);
        return;
      }
      if (kind === "encrypt") {
        if (node.kind === "folder") {
          await invoke<NoteFolder>("encrypt_note_folder", {
            folderId: node.id,
            password,
          });
          unlockFolder(node.id, password);
          const subtreeFolderIds = collectDescendantFolderIds(folders, node.id);
          subtreeFolderIds.add(node.id);
          const nextExpanded = new Set(expandedFolderIds);
          for (const id of subtreeFolderIds) nextExpanded.delete(id);
          setExpandedFolderIds(nextExpanded);
        } else {
          await invoke("encrypt_note", { noteId: node.id, password });
        }
        toast.success(t("notes.password.encryptSuccess"));
        setPasswordAction(null);
        await refresh();
        return;
      }
      if (kind === "decrypt") {
        if (node.kind === "folder") {
          await invoke<NoteFolder>("decrypt_note_folder", {
            folderId: node.id,
            password,
          });
          lockFolder(encryptionRootId(node));
        } else {
          await invoke("decrypt_note", { noteId: node.id, password });
        }
        toast.success(t("notes.password.decryptSuccess"));
        setPasswordAction(null);
        await refresh();
        return;
      }
      if (kind === "change" && newPassword) {
        if (node.kind === "folder") {
          await invoke("change_folder_password", {
            folderId: node.id,
            oldPassword: password,
            newPassword,
          });
        } else {
          await invoke("change_note_password", {
            noteId: node.id,
            oldPassword: password,
            newPassword,
          });
        }
        toast.success(t("notes.password.changeSuccess"));
        setPasswordAction(null);
        await refresh();
      }
    } catch (err) {
      setPasswordError(localizeNotePasswordError(err, t));
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const lockEncryptedFolder = (node: NoteTreeNode) => {
    if (node.kind !== "folder" || !node.encrypted || node.rootFolderId) return;
    const rootId = node.id;
    lockFolder(rootId);

    const subtreeFolderIds = collectDescendantFolderIds(folders, rootId);
    const nextExpanded = new Set(expandedFolderIds);
    for (const id of subtreeFolderIds) nextExpanded.delete(id);
    setExpandedFolderIds(nextExpanded);

    const noteIds = collectNoteIdsInFolderTree(folders, notes, rootId);
    if (noteIds.size === 0) return;
    const tabIds: string[] = [];
    for (const tab of tabs) {
      const hasNote = collectSessionPanes(tab.root).some(
        (pane) => pane.view === "note" && pane.noteId && noteIds.has(pane.noteId),
      );
      if (hasNote) tabIds.push(tab.id);
    }
    if (tabIds.length > 0) closeTabs(tabIds);
  };

  const deleteDescription = deleteTarget
    ? deleteTarget.kind === "folder"
      ? t("notes.deleteFolderDescription", {
          name: deleteTarget.name,
          ...countFolderContents(deleteTarget),
        })
      : t("notes.deleteNoteDescription", { name: deleteTarget.name })
    : "";

  const isEmpty = folders.length === 0 && notes.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <NotesPanelHeader
        title={t("notes.title")}
        search={search}
        onSearchChange={setSearch}
        onNewNote={() => startCreateNote()}
        onNewFolder={() => startCreateFolder()}
        onExpandAll={() => {
          const next = new Set<string>();
          for (const folder of folders) {
            if (!folder.encrypted) {
              next.add(folder.id);
              continue;
            }
            const rootId = folder.encryption?.root_folder_id || folder.id;
            if (isFolderUnlocked(rootId)) next.add(folder.id);
          }
          setExpandedFolderIds(next);
        }}
        onCollapseAll={() => setExpandedFolderIds(new Set())}
        onRefresh={() => void refresh()}
        labels={labels}
      />
      <div className="min-h-0 flex-1" role="tree" tabIndex={0} onKeyDown={handleKeyDown}>
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--df-text-dimmed)]">
            {t("common.loading")}
          </div>
        ) : error ? (
          <div className="p-3 text-xs text-red-400">{error}</div>
        ) : isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <MdDescription className="text-2xl text-[var(--df-text-dimmed)]" />
            <div className="text-sm font-medium text-[var(--df-text)]">{t("notes.emptyTitle")}</div>
            <div className="text-xs text-[var(--df-text-dimmed)]">
              {t("notes.emptyDescription")}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" className="h-7 gap-1.5" onClick={() => startCreateNote(null)}>
                <MdAdd />
                {t("notes.newNote")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5"
                onClick={() => startCreateFolder(null)}
              >
                <MdCreateNewFolder />
                {t("notes.newFolder")}
              </Button>
            </div>
          </div>
        ) : (
          <NoteTree
            rows={visibleRows}
            folderTargets={folderTargets}
            selectedNodeId={selectedNodeId}
            expandedFolderIds={expandedFolderIds}
            editingNodeId={editingNodeId}
            dragOverNodeId={dragOverNodeId}
            labels={labels}
            onSelect={(node) => setSelectedNodeId(node.id)}
            onToggle={toggleFolder}
            onOpen={openNode}
            onRenameStart={(node) => setEditingNodeId(node.id)}
            onRenameSubmit={submitRename}
            onRenameCancel={() => setEditingNodeId(null)}
            onCreateNote={startCreateNote}
            onCreateFolder={startCreateFolder}
            onMove={moveToParent}
            onDelete={requestDelete}
            onEncrypt={(node) => {
              setPasswordError("");
              setPasswordAction({ kind: "encrypt", node });
            }}
            onDecrypt={(node) => {
              setPasswordError("");
              setPasswordAction({ kind: "decrypt", node });
            }}
            onChangePassword={(node) => {
              setPasswordError("");
              setPasswordAction({ kind: "change", node });
            }}
            onLock={lockEncryptedFolder}
            isFolderUnlocked={isFolderUnlocked}
            onRefresh={() => void refresh()}
            onDragStartNode={(node) => {
              dragSourceRef.current = node;
            }}
            onDragOverNode={handleDragOverNode}
            onDropNode={handleDropNode}
            onDragEnd={() => {
              dragSourceRef.current = null;
              setDragOverNodeId(null);
            }}
            onDragOverRoot={handleDragOverRoot}
            onDropRoot={handleDropRoot}
          />
        )}
      </div>
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("notes.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{deleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = deleteTarget;
                setDeleteTarget(null);
                if (target) void runAction(() => deleteNode(target.kind, target.id));
              }}
            >
              {t("notes.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <NotePasswordDialog
        open={!!passwordAction}
        mode={passwordMode}
        targetName={passwordTargetName}
        error={passwordError}
        submitting={passwordSubmitting}
        onSubmit={(password, newPassword) => {
          void handlePasswordSubmit(password, newPassword);
        }}
        onCancel={() => {
          setPasswordAction(null);
          setPasswordError("");
        }}
      />
      <MoveOutChoiceDialog
        open={!!moveOutPending}
        targetName={moveOutPending?.node.name ?? ""}
        onChoose={handleMoveOutChoice}
        onCancel={() => setMoveOutPending(null)}
      />
    </div>
  );
}
