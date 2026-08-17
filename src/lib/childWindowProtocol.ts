export const CHILD_WINDOW_LIFECYCLE_EVENT = "child-window-lifecycle";
export const CHILD_WINDOW_READY_TOKEN_PARAM = "readyToken";

export const CHILD_WINDOW_COMMANDS = {
  settingsOpenTab: "settings-open-tab",
  remoteFileEditorOpen: "remote-file-editor-open",
  filePreviewOpen: "file-preview-open",
} as const;

export type ChildWindowCommandName =
  (typeof CHILD_WINDOW_COMMANDS)[keyof typeof CHILD_WINDOW_COMMANDS];

export type ChildWindowLoadFailureStage = "bootstrap-import" | "command-listener";

export type ChildWindowLifecyclePayload =
  | { label: string; token?: string; phase: "load-started" }
  | { label: string; token?: string; phase: "shell-ready" }
  | {
      label: string;
      token?: string;
      phase: "command-ready";
      command: ChildWindowCommandName;
    }
  | {
      label: string;
      token?: string;
      phase: "load-failed";
      stage: ChildWindowLoadFailureStage;
    };
