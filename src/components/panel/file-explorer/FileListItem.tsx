import { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  MdAutoAwesome,
  MdBookmarkAdd,
  MdContentCopy,
  MdCopyAll,
  MdDelete,
  MdDownload,
  MdDriveFileMove,
  MdDriveFolderUpload,
  MdEdit,
  MdFileOpen,
  MdFolderCopy,
  MdInfo,
  MdKeyboardArrowRight,
  MdKeyboardDoubleArrowRight,
  MdKeyboardReturn,
  MdOpenInNew,
  MdOutlineSubdirectoryArrowRight,
  MdRefresh,
  MdSend,
  MdTerminal,
  MdUpload,
  MdVisibility,
} from "react-icons/md";
import { getFileIcon } from "@/components/icons";
import { cn, formatSize } from "@/lib/utils";
import type { AICustomActionConfig, FileEntry } from "@/types/global";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../ui/context-menu";
import { isKnownBinaryFile } from "./model";

interface FileListItemProps {
  entry: FileEntry;
  isSelected: boolean;
  selectedCount: number;
  isParentDirectoryEntry?: boolean;
  activeSessionId: string | null;
  editorType: "external" | "internal";
  columnTemplate: string;
  rowWidth: number;
  onSelectionStart: (entry: FileEntry, event: React.MouseEvent) => void;
  onSelectionDrag: (entry: FileEntry, event: React.MouseEvent) => void;
  onContextMenuSelect: (entry: FileEntry, event: React.MouseEvent) => void;
  onItemClick: (entry: FileEntry) => void;
  onOpenDefault: (entry: FileEntry) => void;
  onPreview: (entry: FileEntry) => void;
  onOpenInternal: (entry: FileEntry) => void;
  onOpenExternal: (entry: FileEntry) => void;
  onRefresh: () => void;
  showTransferActions: boolean;
  onUpload: () => void;
  onUploadFolder: () => void;
  onDownload: (entry: FileEntry) => void;
  showPeerSendAction?: boolean;
  /** Dual-pane SFTP: show Upload (local) or Download (remote) that sends to the peer pane. */
  peerTransferAction?: "upload" | "download";
  onSendToPeer?: (entry: FileEntry) => void;
  sendTargetOptions?: Array<{
    sessionId: string;
    label: string;
    meta: string;
  }>;
  onSendToTarget?: (entry: FileEntry, targetSessionId: string) => void;
  onRename: (entry: FileEntry) => void;
  onMove: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onAddToFavorites: (entry: FileEntry) => void;
  onCopyPath: (entry: FileEntry, mode: "dir" | "name" | "full") => void;
  /** Hide terminal path/CD actions (SFTP workspace has no shell). Default true. */
  showTerminalActions?: boolean;
  onSendToTerminal: (entry: FileEntry, mode: "dir" | "name" | "full") => void;
  onCdToDirectory: (entry: FileEntry) => void;
  /** Open a new SSH terminal at this directory (SFTP remote). */
  onOpenTerminalHere?: (entry: FileEntry) => void;
  onProperties: (entry: FileEntry) => void;
  onPathPointerDown?: (entry: FileEntry, event: React.PointerEvent) => void;
  onPathPointerMove?: (entry: FileEntry, event: React.PointerEvent) => void;
  onPathPointerUp?: (entry: FileEntry, event: React.PointerEvent) => void;
  onPathPointerCancel?: (entry: FileEntry, event: React.PointerEvent) => void;
  aiActions: AICustomActionConfig[];
  onAIAction: (entry: FileEntry, action: AICustomActionConfig) => void;
  inlineRename?: {
    value: string;
    isSubmitting: boolean;
  } | null;
  onInlineRenameChange: (value: string) => void;
  onInlineRenameSubmit: () => void;
  onInlineRenameCancel: () => void;
}

function formatModifiedTime(unix: number): string {
  if (!unix) return "-";
  const d = new Date(unix * 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getFilenameSelectionEnd(name: string): number {
  const lastDot = name.lastIndexOf(".");
  return lastDot > 0 ? lastDot : name.length;
}

export function FileListItem({
  entry,
  isSelected,
  selectedCount,
  isParentDirectoryEntry = false,
  activeSessionId,
  editorType,
  columnTemplate,
  rowWidth,
  onSelectionStart,
  onSelectionDrag,
  onContextMenuSelect,
  onItemClick,
  onOpenDefault,
  onPreview,
  onOpenInternal,
  onOpenExternal,
  onRefresh,
  showTransferActions,
  onUpload,
  onUploadFolder,
  onDownload,
  showPeerSendAction = false,
  peerTransferAction,
  onSendToPeer,
  sendTargetOptions = [],
  onSendToTarget,
  onRename,
  onMove,
  onDelete,
  onAddToFavorites,
  onCopyPath,
  showTerminalActions = true,
  onSendToTerminal,
  onCdToDirectory,
  onOpenTerminalHere,
  onProperties,
  onPathPointerDown,
  onPathPointerMove,
  onPathPointerUp,
  onPathPointerCancel,
  aiActions,
  onAIAction,
  inlineRename,
  onInlineRenameChange,
  onInlineRenameSubmit,
  onInlineRenameCancel,
}: FileListItemProps) {
  const { t } = useTranslation();
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameBlurGuardUntilRef = useRef(0);
  const renameClickTimerRef = useRef<number | null>(null);
  const wasSingleSelectedOnMouseDownRef = useRef(false);
  const preventNextContextMenuAutoFocusRef = useRef(false);
  const entryIcon = getFileIcon(entry);
  const modifiedTime = formatModifiedTime(entry.mtime);
  const fileSize = isParentDirectoryEntry || entry.is_dir ? "-" : formatSize(entry.size);
  const permissions = isParentDirectoryEntry ? "" : entry.permissions || "-";
  const owner = isParentDirectoryEntry ? "" : entry.owner || "-";
  const group = isParentDirectoryEntry ? "" : entry.group || "-";
  const itemTitle = isParentDirectoryEntry
    ? t("fileExplorer.goUp")
    : `${permissions} ${fileSize} ${modifiedTime} ${owner}:${group}`;
  const isRenaming = !!inlineRename;
  const isFile = !entry.is_dir;
  const showOpenInternal = isFile && editorType === "external" && !isKnownBinaryFile(entry.name);
  const showOpenExternal = isFile && editorType === "internal";
  const peerTransferLabel =
    peerTransferAction === "upload"
      ? t("fileExplorer.uploadToRemoteDir")
      : peerTransferAction === "download"
        ? t("fileExplorer.downloadToLocalDir")
        : t("fileExplorer.sendToPeer");
  const PeerTransferIcon = peerTransferAction === "download" ? MdDownload : MdUpload;
  const showPeerTransferMenu = !!peerTransferAction && !!onSendToPeer && !isParentDirectoryEntry;

  useLayoutEffect(() => {
    if (!isRenaming) {
      return;
    }

    renameBlurGuardUntilRef.current = performance.now() + 350;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(0, getFilenameSelectionEnd(entry.name));
  }, [entry.name, isRenaming]);

  useEffect(() => {
    if (!isRenaming) {
      return;
    }

    let frame = 0;
    const timeout = window.setTimeout(() => {
      frame = window.requestAnimationFrame(() => {
        const input = renameInputRef.current;
        if (!input || document.activeElement === input) return;
        input.focus();
        input.setSelectionRange(0, getFilenameSelectionEnd(entry.name));
      });
      renameBlurGuardUntilRef.current = performance.now() + 350;
    }, 0);

    return () => {
      window.clearTimeout(timeout);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [entry.name, isRenaming]);

  useEffect(() => {
    return () => {
      if (renameClickTimerRef.current !== null) {
        window.clearTimeout(renameClickTimerRef.current);
      }
    };
  }, []);

  const clearPendingRenameClick = () => {
    if (renameClickTimerRef.current === null) return;
    window.clearTimeout(renameClickTimerRef.current);
    renameClickTimerRef.current = null;
  };

  const handleNameClick = (event: React.MouseEvent<HTMLSpanElement>) => {
    if (
      event.button !== 0 ||
      event.detail !== 1 ||
      isRenaming ||
      !activeSessionId ||
      !wasSingleSelectedOnMouseDownRef.current ||
      isParentDirectoryEntry
    ) {
      return;
    }

    clearPendingRenameClick();
    renameClickTimerRef.current = window.setTimeout(() => {
      renameClickTimerRef.current = null;
      onRename(entry);
    }, 220);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          className={cn(
            "file-explorer-row group relative grid h-[30px] items-center select-none",
            !isParentDirectoryEntry && !isRenaming && !!activeSessionId
              ? "file-explorer-row--path-draggable"
              : "cursor-pointer",
            isSelected && "file-explorer-row--selected",
          )}
          data-selected={isSelected ? "true" : undefined}
          // Native HTML5 draggable paints a soft WebView2 highlight on Windows.
          // Path drag uses pointer events instead (see explorerPathDrag session).
          draggable={false}
          style={{
            gridTemplateColumns: columnTemplate,
            width: rowWidth,
            color: isSelected ? "var(--df-primary)" : "var(--df-text)",
          }}
          onMouseEnter={(e) => {
            onSelectionDrag(entry, e);
          }}
          onMouseDown={(e) => {
            wasSingleSelectedOnMouseDownRef.current =
              e.button === 0 && isSelected && selectedCount === 1;
            clearPendingRenameClick();
            if (isRenaming) {
              e.stopPropagation();
              return;
            }
            onSelectionStart(entry, e);
            // Avoid WebView2 focus-band chrome on the row.
            if (e.button === 0) {
              const target = e.currentTarget;
              queueMicrotask(() => {
                if (document.activeElement === target) {
                  target.blur();
                }
              });
            }
          }}
          onPointerDown={(e) => {
            if (isParentDirectoryEntry || isRenaming || !activeSessionId) return;
            clearPendingRenameClick();
            onPathPointerDown?.(entry, e);
          }}
          onPointerMove={(e) => {
            onPathPointerMove?.(entry, e);
          }}
          onPointerUp={(e) => {
            onPathPointerUp?.(entry, e);
          }}
          onPointerCancel={(e) => {
            onPathPointerCancel?.(entry, e);
          }}
          onDoubleClick={() => {
            clearPendingRenameClick();
            if (isRenaming) return;
            if (entry.is_dir) {
              onItemClick(entry);
            } else {
              onOpenDefault(entry);
            }
          }}
          onContextMenu={(e) => {
            if (isRenaming) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            onContextMenuSelect(entry, e);
          }}
          title={itemTitle}
        >
          <div className="flex min-w-0 items-center gap-2 px-2">
            <entryIcon.icon
              className="shrink-0 text-base"
              style={{ color: isSelected ? "var(--df-primary)" : entryIcon.color }}
            />
            {isRenaming ? (
              <input
                ref={renameInputRef}
                type="text"
                className="h-6 min-w-0 flex-1 rounded border border-[var(--df-primary)] bg-[var(--df-bg-panel)] px-1.5 text-xs text-[var(--df-text)] outline-none"
                value={inlineRename.value}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => onInlineRenameChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    onInlineRenameSubmit();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    onInlineRenameCancel();
                  }
                }}
                onBlur={() => {
                  if (performance.now() < renameBlurGuardUntilRef.current) {
                    window.setTimeout(() => {
                      renameInputRef.current?.focus();
                    }, 0);
                    return;
                  }
                  if (!inlineRename.isSubmitting) {
                    onInlineRenameCancel();
                  }
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.stopPropagation()}
                disabled={inlineRename.isSubmitting}
              />
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-xs" onClick={handleNameClick}>
                  {entry.name}
                </span>
                {showPeerSendAction &&
                  !peerTransferAction &&
                  !isParentDirectoryEntry &&
                  onSendToPeer && (
                    <button
                      type="button"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--df-text-dimmed)] opacity-0 transition-opacity hover:bg-[var(--df-bg-hover)] hover:text-[var(--df-primary)] group-hover:opacity-100 group-focus-within:opacity-100"
                      aria-label={peerTransferLabel}
                      title={peerTransferLabel}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onSendToPeer(entry);
                      }}
                    >
                      <MdSend className="h-3.5 w-3.5" />
                    </button>
                  )}
              </>
            )}
          </div>
          <span
            className="truncate px-2 font-mono text-[0.625rem] tabular-nums"
            style={{ color: "var(--df-text-dimmed)" }}
          >
            {isParentDirectoryEntry ? "" : modifiedTime}
          </span>
          <span
            className="truncate px-2 text-right text-[0.625rem] tabular-nums"
            style={{ color: "var(--df-text-dimmed)" }}
          >
            {isParentDirectoryEntry ? "" : fileSize}
          </span>
          <span
            className="truncate px-2 font-mono text-[0.625rem]"
            style={{ color: "var(--df-text-dimmed)" }}
          >
            {permissions}
          </span>
          <span
            className="truncate px-2 text-[0.625rem]"
            style={{ color: "var(--df-text-dimmed)" }}
          >
            {owner}
          </span>
          <span
            className="truncate px-2 text-[0.625rem]"
            style={{ color: "var(--df-text-dimmed)" }}
          >
            {group}
          </span>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="min-w-[200px]"
        onCloseAutoFocus={(event) => {
          if (!preventNextContextMenuAutoFocusRef.current) {
            return;
          }
          preventNextContextMenuAutoFocusRef.current = false;
          event.preventDefault();
        }}
      >
        {isParentDirectoryEntry ? (
          <>
            <ContextMenuItem onClick={() => onItemClick(entry)}>
              <MdFileOpen className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.goUp")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onRefresh}>
              <MdRefresh className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmRefresh")}
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem
              onClick={() => (entry.is_dir ? onItemClick(entry) : onOpenDefault(entry))}
            >
              <MdFileOpen className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmOpen")}
            </ContextMenuItem>
            {isFile && (
              <ContextMenuItem onClick={() => onPreview(entry)}>
                <MdVisibility className="text-[0.875rem] text-muted-foreground mr-2" />
                {t("filePreview.preview")}
              </ContextMenuItem>
            )}
            {showOpenInternal && (
              <ContextMenuItem onClick={() => onOpenInternal(entry)}>
                <MdEdit className="text-[0.875rem] text-muted-foreground mr-2" />
                {t("fileExplorer.cmOpenInternalEditor")}
              </ContextMenuItem>
            )}
            {showOpenExternal && (
              <ContextMenuItem onClick={() => onOpenExternal(entry)}>
                <MdOpenInNew className="text-[0.875rem] text-muted-foreground mr-2" />
                {t("fileExplorer.cmOpenExternalEditor")}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onRefresh}>
              <MdRefresh className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmRefresh")}
            </ContextMenuItem>
            {showPeerTransferMenu && (
              <>
                <ContextMenuItem onClick={() => onSendToPeer?.(entry)}>
                  <PeerTransferIcon className="text-[0.875rem] text-muted-foreground mr-2" />
                  {peerTransferLabel}
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            {onOpenTerminalHere && entry.is_dir && (
              <>
                <ContextMenuItem onClick={() => onOpenTerminalHere(entry)}>
                  <MdTerminal className="text-[0.875rem] text-muted-foreground mr-2" />
                  {t("fileExplorer.openTerminalHere")}
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            {showTransferActions && (
              <>
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <MdUpload className="text-[0.875rem] text-muted-foreground mr-2" />
                    {t("fileExplorer.cmUpload")}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-48">
                    <ContextMenuItem onClick={onUpload}>
                      <MdUpload className="text-[0.875rem] text-muted-foreground mr-2" />
                      {t("fileExplorer.upload")}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={onUploadFolder}>
                      <MdDriveFolderUpload className="text-[0.875rem] text-muted-foreground mr-2" />
                      {t("fileExplorer.uploadFolder")}
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuItem onClick={() => onDownload(entry)}>
                  <MdDownload className="text-[0.875rem] text-muted-foreground mr-2" />
                  {t("fileExplorer.cmDownload")}
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            {sendTargetOptions.length > 0 && onSendToTarget && (
              <>
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <MdSend className="text-[0.875rem] text-muted-foreground mr-2" />
                    {t("fileExplorer.sendToPeer")}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="min-w-52">
                    {sendTargetOptions.map((target) => (
                      <ContextMenuItem
                        key={target.sessionId}
                        onClick={() => onSendToTarget(entry, target.sessionId)}
                      >
                        <span className="min-w-0 flex-1 truncate">{target.label}</span>
                        <span className="ml-2 shrink-0 text-[0.625rem] text-muted-foreground">
                          {target.meta}
                        </span>
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem
              onClick={() => {
                preventNextContextMenuAutoFocusRef.current = true;
                activeSessionId && onRename(entry);
              }}
            >
              <MdEdit className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmRename")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => activeSessionId && onMove(entry)}>
              <MdDriveFileMove className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmMove")}
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onClick={() => onDelete(entry)}>
              <MdDelete className="text-[0.875rem] mr-2" />
              {t("fileExplorer.cmDelete")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            {entry.is_dir && (
              <>
                <ContextMenuItem onClick={() => onAddToFavorites(entry)}>
                  <MdBookmarkAdd className="text-[0.875rem] text-muted-foreground mr-2" />
                  {t("fileExplorer.addToFavorites")}
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem onClick={() => onCopyPath(entry, "full")}>
              <MdContentCopy className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmCopyPath")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onCopyPath(entry, "name")}>
              <MdCopyAll className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmCopyName")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onCopyPath(entry, "dir")}>
              <MdFolderCopy className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmCopyDirPath")}
            </ContextMenuItem>
            {showTerminalActions && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => onSendToTerminal(entry, "full")}>
                  <MdKeyboardReturn className="text-[0.875rem] text-muted-foreground mr-2" />
                  {t("fileExplorer.cmTerminalPath")}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onSendToTerminal(entry, "name")}>
                  <MdKeyboardArrowRight className="text-[0.875rem] text-muted-foreground mr-2" />
                  {t("fileExplorer.cmTerminalName")}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onSendToTerminal(entry, "dir")}>
                  <MdKeyboardDoubleArrowRight className="text-[0.875rem] text-muted-foreground mr-2" />
                  {t("fileExplorer.cmTerminalDirPath")}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onCdToDirectory(entry)}>
                  <MdOutlineSubdirectoryArrowRight className="text-[0.875rem] text-muted-foreground mr-2" />
                  {t("fileExplorer.cmCdToDirectory")}
                </ContextMenuItem>
              </>
            )}
            <ContextMenuSeparator />
            {aiActions.length > 0 && (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <MdAutoAwesome className="text-[0.875rem] text-muted-foreground mr-2" />
                  AI
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {aiActions.map((action) => (
                    <ContextMenuItem key={action.id} onClick={() => onAIAction(entry, action)}>
                      {action.name}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => activeSessionId && onProperties(entry)}>
              <MdInfo className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmProperties")}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
