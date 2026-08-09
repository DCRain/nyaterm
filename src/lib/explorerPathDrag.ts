import type { FileExplorerBackendKind } from "@/components/panel/file-explorer/model";
import { isWindows } from "@/lib/platform";
import { shellQuote } from "@/lib/utils";

export const EXPLORER_PATH_DRAG_MIME = "application/x-nyaterm-explorer-paths";

export interface ExplorerPathDragPayload {
  paths: string[];
  backend: FileExplorerBackendKind;
}

export interface ExplorerPathPointerDragSession {
  payload: ExplorerPathDragPayload;
  x: number;
  y: number;
}

type SessionListener = () => void;
type DropListener = (payload: ExplorerPathDragPayload, x: number, y: number) => boolean;

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

function normalizePayload(payload: ExplorerPathDragPayload): ExplorerPathDragPayload | null {
  const paths = payload.paths.map((path) => path.trim()).filter(Boolean);
  if (paths.length === 0) return null;
  return {
    paths,
    backend: payload.backend === "local" ? "local" : "remote",
  };
}

export function writeExplorerPathDragData(
  dataTransfer: DataTransfer,
  payload: ExplorerPathDragPayload,
): void {
  const normalized = normalizePayload(payload);
  if (!normalized) return;

  dataTransfer.setData(EXPLORER_PATH_DRAG_MIME, JSON.stringify(normalized));
  dataTransfer.setData(
    "text/plain",
    formatExplorerPathsForTerminal(normalized.paths, normalized.backend),
  );
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
    return normalizePayload(parsed);
  } catch {
    return null;
  }
}

/*
 * Pointer-based explorer→terminal path drag.
 * Native HTML5 `draggable` on file rows paints a soft WebView2 highlight band on
 * Windows (independent of CSS backgrounds), so path drag uses pointer events.
 */
const PATH_DRAG_GHOST_ID = "nyaterm-explorer-path-drag-ghost";
const PATH_DRAGGING_CLASS = "nyaterm-explorer-path-dragging";

let pointerSession: ExplorerPathPointerDragSession | null = null;
const sessionListeners = new Set<SessionListener>();
const dropListeners = new Set<DropListener>();
let windowListenersBound = false;

function emitSessionListeners() {
  for (const listener of sessionListeners) {
    listener();
  }
}

function pathBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function ghostLabel(payload: ExplorerPathDragPayload): string {
  if (payload.paths.length === 1) {
    return pathBasename(payload.paths[0]);
  }
  return `${payload.paths.length} paths`;
}

function ensurePathDragGhost(): HTMLDivElement {
  let ghost = document.getElementById(PATH_DRAG_GHOST_ID) as HTMLDivElement | null;
  if (!ghost) {
    ghost = document.createElement("div");
    ghost.id = PATH_DRAG_GHOST_ID;
    ghost.setAttribute("aria-hidden", "true");
    document.body.appendChild(ghost);
  }
  return ghost;
}

function updatePathDragGhost(session: ExplorerPathPointerDragSession) {
  const ghost = ensurePathDragGhost();
  ghost.textContent = ghostLabel(session.payload);
  ghost.style.transform = `translate3d(${session.x + 14}px, ${session.y + 14}px, 0)`;
}

function clearPathDragChrome() {
  document.documentElement.classList.remove(PATH_DRAGGING_CLASS);
  document.getElementById(PATH_DRAG_GHOST_ID)?.remove();
}

function unbindWindowListeners() {
  if (!windowListenersBound) return;
  window.removeEventListener("pointermove", handleWindowPointerMove, true);
  window.removeEventListener("pointerup", handleWindowPointerUp, true);
  window.removeEventListener("pointercancel", handleWindowPointerCancel, true);
  windowListenersBound = false;
}

function bindWindowListeners() {
  if (windowListenersBound) return;
  window.addEventListener("pointermove", handleWindowPointerMove, true);
  window.addEventListener("pointerup", handleWindowPointerUp, true);
  window.addEventListener("pointercancel", handleWindowPointerCancel, true);
  windowListenersBound = true;
}

function handleWindowPointerMove(event: PointerEvent) {
  if (!pointerSession) return;
  pointerSession = {
    ...pointerSession,
    x: event.clientX,
    y: event.clientY,
  };
  updatePathDragGhost(pointerSession);
  emitSessionListeners();
}

function handleWindowPointerUp(event: PointerEvent) {
  if (!pointerSession) return;
  const { payload, x, y } = {
    payload: pointerSession.payload,
    x: event.clientX,
    y: event.clientY,
  };
  pointerSession = null;
  unbindWindowListeners();
  clearPathDragChrome();
  emitSessionListeners();

  for (const listener of dropListeners) {
    if (listener(payload, x, y)) {
      return;
    }
  }
}

function handleWindowPointerCancel() {
  cancelExplorerPathPointerDrag();
}

export function getExplorerPathPointerDrag(): ExplorerPathPointerDragSession | null {
  return pointerSession;
}

export function beginExplorerPathPointerDrag(
  payload: ExplorerPathDragPayload,
  x: number,
  y: number,
): boolean {
  const normalized = normalizePayload(payload);
  if (!normalized) return false;
  pointerSession = { payload: normalized, x, y };
  document.documentElement.classList.add(PATH_DRAGGING_CLASS);
  updatePathDragGhost(pointerSession);
  bindWindowListeners();
  emitSessionListeners();
  return true;
}

export function cancelExplorerPathPointerDrag() {
  if (!pointerSession) {
    clearPathDragChrome();
    return;
  }
  pointerSession = null;
  unbindWindowListeners();
  clearPathDragChrome();
  emitSessionListeners();
}

export function subscribeExplorerPathPointerDrag(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

export function registerExplorerPathPointerDropTarget(listener: DropListener): () => void {
  dropListeners.add(listener);
  return () => {
    dropListeners.delete(listener);
  };
}
