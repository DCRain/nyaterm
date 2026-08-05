import type { FileExplorerBackendKind } from "@/components/panel/file-explorer/model";
import { isWindows } from "@/lib/platform";
import { shellQuote } from "@/lib/utils";

export const EXPLORER_PATH_DRAG_MIME = "application/x-nyaterm-explorer-paths";

export interface ExplorerPathDragPayload {
  paths: string[];
  backend: FileExplorerBackendKind;
}

function quoteWindowsPath(path: string): string {
  if (!/[\s"]/.test(path)) {
    return path;
  }
  return `"${path.replace(/"/g, '\\"')}"`;
}

function quoteUnixPath(path: string): string {
  if (!/[\s'"\\]/.test(path)) {
    return path;
  }
  return shellQuote(path);
}

/** Format explorer paths for insertion into a shell command line. */
export function formatExplorerPathsForTerminal(
  paths: string[],
  backend: FileExplorerBackendKind,
): string {
  const quote = backend === "local" && isWindows ? quoteWindowsPath : quoteUnixPath;
  return paths.map(quote).join(" ");
}

export function writeExplorerPathDragData(
  dataTransfer: DataTransfer,
  payload: ExplorerPathDragPayload,
): void {
  const paths = payload.paths.map((path) => path.trim()).filter(Boolean);
  if (paths.length === 0) return;

  const normalized: ExplorerPathDragPayload = {
    paths,
    backend: payload.backend,
  };
  dataTransfer.setData(EXPLORER_PATH_DRAG_MIME, JSON.stringify(normalized));
  dataTransfer.setData("text/plain", formatExplorerPathsForTerminal(paths, payload.backend));
  dataTransfer.effectAllowed = "copy";
}

export function hasExplorerPathDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes(EXPLORER_PATH_DRAG_MIME);
}

export function readExplorerPathDragData(
  dataTransfer: DataTransfer | null,
): ExplorerPathDragPayload | null {
  if (!dataTransfer) return null;

  const raw = dataTransfer.getData(EXPLORER_PATH_DRAG_MIME);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ExplorerPathDragPayload;
    if (!parsed || !Array.isArray(parsed.paths) || parsed.paths.length === 0) {
      return null;
    }
    const backend: FileExplorerBackendKind = parsed.backend === "local" ? "local" : "remote";
    const paths = parsed.paths.map((path) => String(path).trim()).filter(Boolean);
    if (paths.length === 0) return null;
    return { paths, backend };
  } catch {
    return null;
  }
}
