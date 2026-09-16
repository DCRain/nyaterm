import type { FileExplorerBackendKind } from "@/components/panel/file-explorer/model";
import { getFileExtension } from "@/components/panel/file-explorer/model";
import { formatExplorerPathsForTerminal } from "@/lib/explorerPathDrag";
import type {
  FileEntry,
  FileExplorerActionConfirmationLevel,
  FileExplorerCustomAction,
} from "@/types/global";

export interface FileExplorerActionContext {
  fullPath: string;
  parentDir: string;
  backend: FileExplorerBackendKind;
}

/** Escape regex metacharacters except glob wildcards already rewritten. */
function escapeRegexLiteral(value: string): string {
  return value.replace(/[|\\{}()[\]^$+.]/g, "\\$&");
}

/** Simple case-insensitive glob matcher supporting `*` and `?`. */
export function matchSimpleGlob(pattern: string, text: string): boolean {
  const normalizedPattern = pattern.trim().toLocaleLowerCase();
  const normalizedText = text.toLocaleLowerCase();
  if (!normalizedPattern) return false;

  let regexSource = "";
  for (const char of normalizedPattern) {
    if (char === "*") {
      regexSource += ".*";
    } else if (char === "?") {
      regexSource += ".";
    } else {
      regexSource += escapeRegexLiteral(char);
    }
  }

  return new RegExp(`^${regexSource}$`, "u").test(normalizedText);
}

export function normalizeFileExplorerMatchPattern(pattern: string): string {
  const trimmed = pattern.trim();
  if (!trimmed) return "";
  // ".log" without wildcards is treated as "*.log"
  if (trimmed.startsWith(".") && !trimmed.includes("*") && !trimmed.includes("?")) {
    return `*${trimmed}`;
  }
  return trimmed;
}

/** Split a config pattern field into individual patterns (whitespace-separated). */
export function splitFileExplorerMatchPatterns(pattern: string): string[] {
  return pattern
    .trim()
    .split(/\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function matchesSingleFileExplorerActionPattern(pattern: string, entryName: string): boolean {
  const normalized = normalizeFileExplorerMatchPattern(pattern);
  if (!normalized) return false;

  if (!normalized.includes("*") && !normalized.includes("?")) {
    return entryName.toLocaleLowerCase() === normalized.toLocaleLowerCase();
  }

  // Fast path for extension-style patterns like "*.log"
  if (
    normalized.startsWith("*.") &&
    !normalized.slice(2).includes("*") &&
    !normalized.includes("?")
  ) {
    const expectedExt = normalized.slice(2).toLocaleLowerCase();
    return getFileExtension(entryName) === expectedExt;
  }

  return matchSimpleGlob(normalized, entryName);
}

/** Match if any whitespace-separated pattern matches the entry name. */
export function matchesFileExplorerActionPattern(pattern: string, entryName: string): boolean {
  const patterns = splitFileExplorerMatchPatterns(pattern);
  if (patterns.length === 0) return false;
  return patterns.some((part) => matchesSingleFileExplorerActionPattern(part, entryName));
}

export function matchesFileExplorerActionTarget(
  target: FileExplorerCustomAction["target"] | string,
  isDirectory: boolean,
): boolean {
  // Legacy "any" configs are treated as files.
  if (target === "directory") return isDirectory;
  return !isDirectory;
}

export function matchFileExplorerActions(
  actions: FileExplorerCustomAction[] | undefined,
  entry: Pick<FileEntry, "name" | "is_dir">,
): FileExplorerCustomAction[] {
  if (!actions?.length) return [];
  return actions.filter((action) => {
    if (!action.enabled || !action.name.trim() || !action.command.trim()) return false;
    if (!matchesFileExplorerActionTarget(action.target, entry.is_dir)) return false;
    // Folders do not use filename/extension patterns — apply to every directory.
    if (action.target === "directory") return true;
    return matchesFileExplorerActionPattern(action.match_pattern, entry.name);
  });
}

function quoteForBackend(path: string, backend: FileExplorerBackendKind): string {
  return formatExplorerPathsForTerminal([path], backend);
}

function getBasename(name: string): string {
  const ext = getFileExtension(name);
  if (!ext) return name;
  const lower = name.toLocaleLowerCase();
  const suffix = `.${ext}`;
  if (!lower.endsWith(suffix)) return name;
  return name.slice(0, name.length - suffix.length);
}

export function expandCommandTemplate(
  template: string,
  entry: Pick<FileEntry, "name">,
  context: FileExplorerActionContext,
): string {
  const quotedPath = quoteForBackend(context.fullPath, context.backend);
  const quotedName = quoteForBackend(entry.name, context.backend);
  const quotedParentDir = quoteForBackend(context.parentDir || ".", context.backend);
  const basename = getBasename(entry.name);

  return template
    .split("{path}")
    .join(quotedPath)
    .split("{name}")
    .join(quotedName)
    .split("{parentdir}")
    .join(quotedParentDir)
    .split("{dir}")
    .join(quotedParentDir)
    .split("{basename}")
    .join(basename);
}

export function normalizeFileExplorerConfirmationLevel(
  level: string | undefined,
): FileExplorerActionConfirmationLevel {
  if (level === "warning" || level === "danger") return level;
  return "none";
}

export function createFileExplorerCustomAction(
  partial?: Partial<FileExplorerCustomAction>,
): FileExplorerCustomAction {
  const id =
    partial?.id ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `file-action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  return {
    id,
    name: partial?.name ?? "",
    enabled: partial?.enabled ?? true,
    match_pattern: partial?.match_pattern ?? "",
    target: partial?.target ?? "file",
    command: partial?.command ?? "",
    execute: partial?.execute ?? true,
    max_file_size_bytes: partial?.max_file_size_bytes ?? 0,
    confirmation_level: normalizeFileExplorerConfirmationLevel(partial?.confirmation_level),
  };
}

/** Returns true when the action may run against this file size. */
export function isFileExplorerActionSizeAllowed(
  action: Pick<FileExplorerCustomAction, "target" | "max_file_size_bytes">,
  fileSizeBytes: number,
): boolean {
  if (action.target === "directory") return true;
  const limit = action.max_file_size_bytes ?? 0;
  if (limit <= 0) return true;
  return fileSizeBytes <= limit;
}
