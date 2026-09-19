import type { TransferSettings } from "@/types/global";

export type InternalEditorDisplay = TransferSettings["internal_editor_display"];
export type FileEditorOpenTarget =
  | "external"
  | "internal-workspace"
  | "internal-window";

type EditorOpenSettings = Pick<TransferSettings, "editor_type"> &
  Partial<Pick<TransferSettings, "internal_editor_display">>;

export function resolveInternalEditorDisplay(
  // The workspace-tab editor mode has been removed — the built-in editor now
  // always opens in its own independent window (see the CodeMirror opaque-iframe
  // rendering fix). Kept as a function (ignoring its argument) so any legacy
  // persisted `"workspace"` value normalizes to `"window"` without a migration.
  _value?: TransferSettings["internal_editor_display"] | string,
): InternalEditorDisplay {
  return "window";
}

export function resolveFileEditorOpenTarget(
  settings: EditorOpenSettings,
): FileEditorOpenTarget {
  if ((settings.editor_type || "external") !== "internal") {
    return "external";
  }

  return resolveInternalEditorDisplay(settings.internal_editor_display) ===
    "window"
    ? "internal-window"
    : "internal-workspace";
}
