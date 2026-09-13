import {
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import FileExplorerTreeItem from "./FileExplorerTreeItem";
import {
  treePathKey,
  type FileExplorerTreeRow,
} from "./fileExplorerTreeModel";
import type { FileExplorerBackendKind } from "./model";

export const FILE_EXPLORER_TREE_ROW_HEIGHT = 28;

interface FileExplorerTreeProps {
  rows: FileExplorerTreeRow[];
  selectedPaths: Set<string>;
  backend: FileExplorerBackendKind;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  revealRequest: { id: number; path: string } | null;
  onRowClick: (
    row: FileExplorerTreeRow,
    event: MouseEvent<HTMLDivElement>,
  ) => void;
  onRowKeyDown: (
    event: KeyboardEvent<HTMLDivElement>,
    row: FileExplorerTreeRow,
  ) => void;
  onSelectAll: () => void;
  onDeleteSelected: () => void;
  onToggleDirectory: (row: FileExplorerTreeRow) => void;
  onActivateDirectory: (row: FileExplorerTreeRow) => void;
  onOpenFile: (row: FileExplorerTreeRow) => void;
  onRequestRename: (row: FileExplorerTreeRow) => void;
  onRetry: (row: FileExplorerTreeRow) => void;
  inlineRename: {
    path: string;
    value: string;
    isSubmitting: boolean;
  } | null;
  onInlineRenameChange: (value: string) => void;
  onInlineRenameSubmit: () => void;
  onInlineRenameCancel: () => void;
  onContextMenuRow: (row: FileExplorerTreeRow | null) => void;
  onContextMenuSelect: (row: FileExplorerTreeRow | null) => void;
  labels: {
    collapse: string;
    expand: string;
    loading: string;
    retry: string;
    emptyDirectory: string;
    tree: string;
  };
}

export default function FileExplorerTree({
  rows,
  selectedPaths,
  backend,
  scrollContainerRef,
  revealRequest,
  onRowClick,
  onRowKeyDown,
  onSelectAll,
  onDeleteSelected,
  onToggleDirectory,
  onActivateDirectory,
  onOpenFile,
  onRequestRename,
  onRetry,
  inlineRename,
  onInlineRenameChange,
  onInlineRenameSubmit,
  onInlineRenameCancel,
  onContextMenuRow,
  onContextMenuSelect,
  labels,
}: FileExplorerTreeProps) {
  const rowByPath = useMemo(
    () => new Map<string, FileExplorerTreeRow>(rows.map((row) => [row.path, row] as const)),
    [rows],
  );
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => FILE_EXPLORER_TREE_ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.path ?? index,
    overscan: 8,
  });
  const previousRowCountRef = useRef(rows.length);
  const handledRevealRequestRef = useRef<number | null>(null);

  useEffect(() => {
    if (previousRowCountRef.current === rows.length) return;
    previousRowCountRef.current = rows.length;
    rowVirtualizer.measure();
  }, [rowVirtualizer, rows.length]);

  useEffect(() => {
    if (!revealRequest || handledRevealRequestRef.current === revealRequest.id) {
      return;
    }
    const targetKey = treePathKey(revealRequest.path, backend);
    const targetIndex = rows.findIndex(
      (row) => treePathKey(row.path, backend) === targetKey,
    );
    if (targetIndex < 0) return;
    handledRevealRequestRef.current = revealRequest.id;
    rowVirtualizer.scrollToIndex(targetIndex, { align: "auto" });
  }, [backend, revealRequest, rowVirtualizer, rows]);

  return (
    <div
      role="tree"
      aria-label={labels.tree}
      className="relative min-h-full p-1.5 text-xs"
      style={{ height: rowVirtualizer.getTotalSize() + 12 }}
      onContextMenu={(event) => {
        const target = event.target instanceof Element ? event.target : null;
        const path = target?.closest<HTMLElement>("[data-file-tree-path]")?.dataset.fileTreePath;
        const row = path ? (rowByPath.get(path) ?? null) : null;
        onContextMenuSelect(row);
        onContextMenuRow(row);
      }}
    >
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index];
        if (!row) return null;
        const selected = selectedPaths.has(treePathKey(row.path, backend));
        return (
          <div
            key={virtualRow.key}
            className="absolute left-0 top-0 w-full"
            style={{
              height: virtualRow.size,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <FileExplorerTreeItem
              row={row}
              selected={selected}
              onClick={(event) => onRowClick(row, event)}
              onDoubleClick={() => {
                if (row.entry.is_dir) {
                  if (!row.isRoot) onActivateDirectory(row);
                  if (!row.isRoot && !row.entry.is_symlink) {
                    onToggleDirectory(row);
                  }
                } else {
                  onOpenFile(row);
                }
              }}
              onKeyDown={(event) => {
                if (
                  (event.ctrlKey || event.metaKey) &&
                  !event.altKey &&
                  !event.shiftKey &&
                  event.key.toLowerCase() === "a"
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectAll();
                  return;
                }
                if (
                  event.key === "Delete" &&
                  !event.altKey &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.shiftKey
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  onDeleteSelected();
                  return;
                }
                onRowKeyDown(event, row);
                if (event.key === "Enter" && !row.entry.is_dir) {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenFile(row);
                  return;
                }
                if (event.key === "F2") {
                  event.preventDefault();
                  event.stopPropagation();
                  onRequestRename(row);
                }
              }}
              onToggle={() => onToggleDirectory(row)}
              onRetry={() => onRetry(row)}
              inlineRename={inlineRename?.path === row.path ? inlineRename : null}
              onInlineRenameChange={onInlineRenameChange}
              onInlineRenameSubmit={onInlineRenameSubmit}
              onInlineRenameCancel={onInlineRenameCancel}
              labels={labels}
            />
          </div>
        );
      })}
      {rows.length === 1 &&
        rows[0]?.isRoot &&
        rows[0].directoryStatus === "loaded" && (
          <div className="absolute inset-x-0 top-8 px-2 py-4 text-center text-xs text-[var(--df-text-dimmed)]">
            {labels.emptyDirectory}
          </div>
        )}
      {rows.length === 0 && (
        <div className="px-2 py-4 text-center text-xs text-[var(--df-text-dimmed)]">
          {labels.loading}
        </div>
      )}
    </div>
  );
}
