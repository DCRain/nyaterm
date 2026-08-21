import type { NoteFolder, NoteNodeKind, NoteSummary, NoteTreeNode } from "@/types/notes";

export interface NoteTreeRow {
  node: NoteTreeNode;
  depth: number;
}

export function buildNoteTree(folders: NoteFolder[], notes: NoteSummary[]): NoteTreeNode[] {
  const nodes = new Map<string, NoteTreeNode>();
  const roots: NoteTreeNode[] = [];

  for (const folder of folders) {
    nodes.set(folder.id, {
      id: folder.id,
      kind: "folder",
      parentId: folder.parent_id ?? null,
      name: folder.name,
      sortOrder: folder.sort_order,
      updatedAtMs: folder.updated_at_ms,
      encrypted: Boolean(folder.encrypted),
      rootFolderId: folder.encryption?.root_folder_id ?? null,
      children: [],
    });
  }

  for (const note of notes) {
    nodes.set(note.id, {
      id: note.id,
      kind: "note",
      parentId: note.parent_id ?? null,
      name: note.title,
      sortOrder: note.sort_order,
      revision: note.revision,
      updatedAtMs: note.updated_at_ms,
      encrypted: Boolean(note.encrypted),
      rootFolderId: note.root_folder_id ?? null,
      children: [],
    });
  }

  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (items: NoteTreeNode[]) => {
    items.sort(compareNoteNodes);
    for (const item of items) sortNodes(item.children);
  };
  sortNodes(roots);
  return roots;
}

export function filterNoteTree(nodes: NoteTreeNode[], keyword: string): NoteTreeNode[] {
  if (!keyword) return nodes;
  const normalized = keyword.toLowerCase();
  const visit = (node: NoteTreeNode): NoteTreeNode | null => {
    const children = node.children.map(visit).filter((item): item is NoteTreeNode => Boolean(item));
    if (node.name.toLowerCase().includes(normalized) || children.length > 0) {
      return { ...node, children };
    }
    return null;
  };
  return nodes.map(visit).filter((item): item is NoteTreeNode => Boolean(item));
}

export function compareNoteNodes(left: NoteTreeNode, right: NoteTreeNode) {
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
  if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
  return (
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
    left.id.localeCompare(right.id)
  );
}

export function flattenVisibleNoteTree(
  nodes: NoteTreeNode[],
  expandedFolderIds: Set<string>,
): NoteTreeRow[] {
  const result: NoteTreeRow[] = [];
  const visit = (items: NoteTreeNode[], depth: number) => {
    for (const item of items) {
      result.push({ node: item, depth });
      if (item.kind === "folder" && expandedFolderIds.has(item.id)) {
        visit(item.children, depth + 1);
      }
    }
  };
  visit(nodes, 0);
  return result;
}

export function flattenNoteFolders(nodes: NoteTreeNode[]): NoteTreeRow[] {
  const result: NoteTreeRow[] = [];
  const visit = (items: NoteTreeNode[], depth: number) => {
    for (const item of items) {
      if (item.kind !== "folder") continue;
      result.push({ node: item, depth });
      visit(item.children, depth + 1);
    }
  };
  visit(nodes, 0);
  return result;
}

export function findNoteNode(nodes: NoteTreeNode[], id: string | null): NoteTreeNode | null {
  if (!id) return null;
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNoteNode(node.children, id);
    if (child) return child;
  }
  return null;
}

export function isDescendantFolder(nodes: NoteTreeNode[], sourceId: string, targetId: string) {
  const source = findNoteNode(nodes, sourceId);
  if (!source || source.kind !== "folder") return false;
  return Boolean(findNoteNode(source.children, targetId));
}

export function normalizeNoteInputName(value: string) {
  return value.trim();
}

export function validateNoteInputName(value: string, siblingNames: string[]) {
  const name = normalizeNoteInputName(value);
  if (!name) return "empty";
  if (Array.from(name).length > 120) return "tooLong";
  if (/[\\/]/.test(name)) return "slash";
  if (Array.from(name).some((char) => /[\u0000-\u001f\u007f]/.test(char))) return "control";
  if (siblingNames.some((item) => item.toLowerCase() === name.toLowerCase())) return "duplicate";
  return null;
}

export function collectSiblingNames(
  folders: NoteFolder[],
  notes: NoteSummary[],
  parentId: string | null,
  exclude?: { id: string; kind: NoteNodeKind },
) {
  const names: string[] = [];
  for (const folder of folders) {
    if (
      (folder.parent_id ?? null) === parentId &&
      !(exclude?.kind === "folder" && exclude.id === folder.id)
    ) {
      names.push(folder.name);
    }
  }
  for (const note of notes) {
    if (
      (note.parent_id ?? null) === parentId &&
      !(exclude?.kind === "note" && exclude.id === note.id)
    ) {
      names.push(note.title);
    }
  }
  return names;
}

/** Root folder id plus all descendant folder ids. */
export function collectDescendantFolderIds(folders: NoteFolder[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      const parentId = folder.parent_id ?? null;
      if (parentId && ids.has(parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  return ids;
}

/** Note ids under a folder tree (by parent path or root_folder_id). */
export function collectNoteIdsInFolderTree(
  folders: NoteFolder[],
  notes: NoteSummary[],
  rootId: string,
): Set<string> {
  const folderIds = collectDescendantFolderIds(folders, rootId);
  const noteIds = new Set<string>();
  for (const note of notes) {
    const parentId = note.parent_id ?? null;
    if (parentId && folderIds.has(parentId)) {
      noteIds.add(note.id);
      continue;
    }
    if (note.root_folder_id === rootId) {
      noteIds.add(note.id);
    }
  }
  return noteIds;
}
