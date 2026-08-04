import { type DragEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { MdChevronRight, MdDescription, MdFolder, MdFolderOpen } from "react-icons/md";
import { cn } from "@/lib/utils";
import type { NoteTreeNode } from "@/types/notes";
import type { NoteTreeMenuLabels } from "./NoteTreeContextMenu";

interface NoteTreeItemProps {
  node: NoteTreeNode;
  depth: number;
  selected: boolean;
  expanded: boolean;
  editing: boolean;
  dragOver: boolean;
  labels: NoteTreeMenuLabels;
  onSelect: (node: NoteTreeNode) => void;
  onToggle: (node: NoteTreeNode) => void;
  onOpen: (node: NoteTreeNode) => void;
  onRenameSubmit: (node: NoteTreeNode, name: string) => void;
  onRenameCancel: () => void;
  onDragStartNode: (node: NoteTreeNode) => void;
  onDragOverNode: (event: DragEvent<HTMLDivElement>, node: NoteTreeNode) => void;
  onDropNode: (event: DragEvent<HTMLDivElement>, node: NoteTreeNode) => void;
  onDragEnd: () => void;
}

export default function NoteTreeItem({
  node,
  depth,
  selected,
  expanded,
  editing,
  dragOver,
  labels,
  onSelect,
  onToggle,
  onOpen,
  onRenameSubmit,
  onRenameCancel,
  onDragStartNode,
  onDragOverNode,
  onDropNode,
  onDragEnd,
}: NoteTreeItemProps) {
  const [name, setName] = useState(node.name);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isFolder = node.kind === "folder";

  useEffect(() => {
    if (!editing) {
      setName(node.name);
      return;
    }
    setName(node.name);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [editing, node.name]);

  const submitRename = () => {
    const next = name.trim();
    if (!next || next === node.name) {
      onRenameCancel();
      return;
    }
    onRenameSubmit(node, next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onRenameCancel();
    }
  };

  return (
    <div
      data-note-node-id={node.id}
      draggable={!editing}
      className={cn(
        "group flex h-7 min-w-0 cursor-default items-center gap-1 rounded px-1 text-xs outline-none transition-colors",
        selected
          ? "bg-[color-mix(in_srgb,var(--df-primary)_18%,transparent)] text-[var(--df-text)]"
          : "text-[var(--df-text-muted)] hover:bg-[var(--df-bg-hover)] hover:text-[var(--df-text)]",
        dragOver && "ring-1 ring-[var(--df-primary)]",
      )}
      style={{ paddingLeft: 4 + depth * 14 }}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={isFolder ? expanded : undefined}
      tabIndex={0}
      onClick={() => onSelect(node)}
      onDoubleClick={() => {
        if (isFolder) onToggle(node);
        else onOpen(node);
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-nyaterm-note-node", node.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStartNode(node);
      }}
      onDragOver={(event) => onDragOverNode(event, node)}
      onDrop={(event) => onDropNode(event, node)}
      onDragEnd={onDragEnd}
    >
      {isFolder ? (
        <button
          type="button"
          aria-label={expanded ? labels.collapseAll : labels.expandAll}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--df-text-dimmed)] transition hover:bg-[var(--df-bg-hover)] hover:text-[var(--df-text)]"
          onClick={(event) => {
            event.stopPropagation();
            onToggle(node);
          }}
        >
          <MdChevronRight
            className={cn("text-base transition-transform", expanded && "rotate-90")}
          />
        </button>
      ) : (
        <span className="h-5 w-5 shrink-0" />
      )}
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {isFolder ? (
          expanded ? (
            <MdFolderOpen className="text-base text-[var(--df-primary)]" />
          ) : (
            <MdFolder className="text-base text-[var(--df-text-muted)]" />
          )
        ) : (
          <MdDescription className="text-sm text-[var(--df-text-muted)]" />
        )}
      </span>
      {editing ? (
        <input
          ref={inputRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={submitRename}
          onKeyDown={handleKeyDown}
          className="h-5 min-w-0 flex-1 rounded border border-[var(--df-primary)] bg-[var(--df-bg-panel)] px-1 text-xs text-[var(--df-text)] outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      )}
    </div>
  );
}
