import { useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import type { NoteTreeNode } from "@/types/notes";
import NoteTreeContextMenu, { type NoteTreeMenuLabels } from "./NoteTreeContextMenu";
import NoteTreeItem from "./NoteTreeItem";
import type { NoteTreeRow } from "./noteTreeUtils";

const NOTE_TREE_ROW_HEIGHT = 28;

interface NoteTreeProps {
  rows: NoteTreeRow[];
  folderTargets: NoteTreeRow[];
  selectedNodeId: string | null;
  expandedFolderIds: Set<string>;
  editingNodeId: string | null;
  dragOverNodeId: string | null;
  labels: NoteTreeMenuLabels;
  onSelect: (node: NoteTreeNode) => void;
  onToggle: (node: NoteTreeNode) => void;
  onOpen: (node: NoteTreeNode) => void;
  onRenameStart: (node: NoteTreeNode) => void;
  onRenameSubmit: (node: NoteTreeNode, name: string) => void;
  onRenameCancel: () => void;
  onCreateNote: (parentId: string | null) => void;
  onCreateFolder: (parentId: string | null) => void;
  onMove: (node: NoteTreeNode, parentId: string | null) => void;
  onDelete: (node: NoteTreeNode) => void;
  onRefresh: () => void;
  onDragStartNode: (node: NoteTreeNode) => void;
  onDragOverNode: (event: DragEvent<HTMLDivElement>, node: NoteTreeNode) => void;
  onDropNode: (event: DragEvent<HTMLDivElement>, node: NoteTreeNode) => void;
  onDragEnd: () => void;
  onDragOverRoot: (event: DragEvent<HTMLDivElement>) => void;
  onDropRoot: (event: DragEvent<HTMLDivElement>) => void;
}

export default function NoteTree(props: NoteTreeProps) {
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const [contextNode, setContextNode] = useState<NoteTreeNode | null>(null);
  const nodeById = useMemo(
    () => new Map(props.rows.map(({ node }) => [node.id, node])),
    [props.rows],
  );
  const rowVirtualizer = useVirtualizer({
    count: props.rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => NOTE_TREE_ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={scrollParentRef}
          className="terminal-scroll h-full min-h-0 flex-1 overflow-auto p-1.5 text-xs"
          onContextMenu={(event) => {
            const target = event.target instanceof HTMLElement ? event.target : null;
            const item = target?.closest<HTMLElement>("[data-note-node-id]");
            setContextNode(item ? (nodeById.get(item.dataset.noteNodeId ?? "") ?? null) : null);
          }}
          onDragOver={props.onDragOverRoot}
          onDrop={props.onDropRoot}
        >
          <div className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = props.rows[virtualRow.index];
              if (!row) return null;
              const { node, depth } = row;
              return (
                <div
                  key={virtualRow.key}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <NoteTreeItem
                    node={node}
                    depth={depth}
                    selected={props.selectedNodeId === node.id}
                    expanded={props.expandedFolderIds.has(node.id)}
                    editing={props.editingNodeId === node.id}
                    dragOver={props.dragOverNodeId === node.id}
                    labels={props.labels}
                    onSelect={props.onSelect}
                    onToggle={props.onToggle}
                    onOpen={props.onOpen}
                    onRenameSubmit={props.onRenameSubmit}
                    onRenameCancel={props.onRenameCancel}
                    onDragStartNode={props.onDragStartNode}
                    onDragOverNode={props.onDragOverNode}
                    onDropNode={props.onDropNode}
                    onDragEnd={props.onDragEnd}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </ContextMenuTrigger>
      <NoteTreeContextMenu
        node={contextNode}
        folderTargets={props.folderTargets}
        labels={props.labels}
        onOpen={props.onOpen}
        onCreateNote={props.onCreateNote}
        onCreateFolder={props.onCreateFolder}
        onRename={props.onRenameStart}
        onMove={props.onMove}
        onDelete={props.onDelete}
        onRefresh={props.onRefresh}
      />
    </ContextMenu>
  );
}
