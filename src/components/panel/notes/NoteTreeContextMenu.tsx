import {
  MdAdd,
  MdCreateNewFolder,
  MdDelete,
  MdDriveFileMove,
  MdEdit,
  MdLock,
  MdLockOpen,
  MdOpenInNew,
  MdPassword,
  MdRefresh,
} from "react-icons/md";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import type { NoteTreeNode } from "@/types/notes";
import type { NoteTreeRow } from "./noteTreeUtils";

export interface NoteTreeMenuLabels {
  open: string;
  newNote: string;
  newFolder: string;
  rename: string;
  moveTo: string;
  delete: string;
  refresh: string;
  root: string;
  expandAll: string;
  collapseAll: string;
  encrypt: string;
  decrypt: string;
  changePassword: string;
  encrypted: string;
  lock: string;
}

interface NoteTreeContextMenuProps {
  node: NoteTreeNode | null;
  folderTargets: NoteTreeRow[];
  labels: NoteTreeMenuLabels;
  folderSessionUnlocked?: boolean;
  onOpen: (node: NoteTreeNode) => void;
  onCreateNote: (parentId: string | null) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRename: (node: NoteTreeNode) => void;
  onMove: (node: NoteTreeNode, parentId: string | null) => void;
  onDelete: (node: NoteTreeNode) => void;
  onEncrypt: (node: NoteTreeNode) => void;
  onDecrypt: (node: NoteTreeNode) => void;
  onChangePassword: (node: NoteTreeNode) => void;
  onLock: (node: NoteTreeNode) => void;
  onRefresh: () => void;
}

function containsNode(node: NoteTreeNode, targetId: string): boolean {
  return node.children.some((child) => child.id === targetId || containsNode(child, targetId));
}

/** Standalone encrypted notes, or encryption-root folders. */
function canManageEncryption(node: NoteTreeNode): boolean {
  if (!node.encrypted) return true;
  if (node.kind === "folder") return !node.rootFolderId;
  return !node.rootFolderId;
}

export default function NoteTreeContextMenu({
  node,
  folderTargets,
  labels,
  folderSessionUnlocked = false,
  onOpen,
  onCreateNote,
  onCreateFolder,
  onRename,
  onMove,
  onDelete,
  onEncrypt,
  onDecrypt,
  onChangePassword,
  onLock,
  onRefresh,
}: NoteTreeContextMenuProps) {
  const parentId = node?.kind === "folder" ? node.id : (node?.parentId ?? null);
  const moveTargets = folderTargets.filter(
    (item) =>
      item.node.id !== node?.id && !(node?.kind === "folder" && containsNode(node, item.node.id)),
  );
  const showEncrypt = node && !node.encrypted && canManageEncryption(node);
  const showDecrypt = node?.encrypted && canManageEncryption(node);
  const showLock =
    node?.kind === "folder" &&
    node.encrypted &&
    !node.rootFolderId &&
    folderSessionUnlocked;

  return (
    <ContextMenuContent className="min-w-40">
      {node?.kind === "note" ? (
        <ContextMenuItem onClick={() => onOpen(node)}>
          <MdOpenInNew />
          {labels.open}
        </ContextMenuItem>
      ) : null}
      {node ? (
        <>
          {node.kind === "folder" ? (
            <>
              <ContextMenuItem onClick={() => onCreateNote(node.id)}>
                <MdAdd />
                {labels.newNote}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onCreateFolder(node.id)}>
                <MdCreateNewFolder />
                {labels.newFolder}
              </ContextMenuItem>
            </>
          ) : null}
          <ContextMenuItem onClick={() => onRename(node)}>
            <MdEdit />
            {labels.rename}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <MdDriveFileMove />
              {labels.moveTo}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-72 min-w-44 overflow-y-auto">
              <ContextMenuItem onClick={() => onMove(node, null)}>{labels.root}</ContextMenuItem>
              {moveTargets.map(({ node: folder, depth }) => (
                <ContextMenuItem key={folder.id} onClick={() => onMove(node, folder.id)}>
                  <span style={{ paddingLeft: depth * 10 }}>{folder.name}</span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          {showEncrypt || showDecrypt || showLock ? <ContextMenuSeparator /> : null}
          {showEncrypt ? (
            <ContextMenuItem onClick={() => onEncrypt(node)}>
              <MdLock />
              {labels.encrypt}
            </ContextMenuItem>
          ) : null}
          {showDecrypt ? (
            <>
              <ContextMenuItem onClick={() => onDecrypt(node)}>
                <MdLockOpen />
                {labels.decrypt}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onChangePassword(node)}>
                <MdPassword />
                {labels.changePassword}
              </ContextMenuItem>
            </>
          ) : null}
          {showLock ? (
            <ContextMenuItem onClick={() => onLock(node)}>
              <MdLock />
              {labels.lock}
            </ContextMenuItem>
          ) : null}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => onDelete(node)}>
            <MdDelete />
            {labels.delete}
          </ContextMenuItem>
        </>
      ) : (
        <>
          <ContextMenuItem onClick={() => onCreateNote(parentId)}>
            <MdAdd />
            {labels.newNote}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onCreateFolder(parentId)}>
            <MdCreateNewFolder />
            {labels.newFolder}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onRefresh}>
            <MdRefresh />
            {labels.refresh}
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );
}
