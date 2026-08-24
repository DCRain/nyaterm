import type { SessionType } from "@/types/global";

export const OPEN_SEND_COMMAND_PANEL_EVENT = "nyaterm:open-send-command-panel";

export type SendCommandDataType = "text" | "hex";
export type SendCommandMode = "line" | "character" | "byte" | "packet";
export type SendCommandTarget = "current" | "all" | "allWindows";
export type SendCommandCount = number | null;

export interface SendCommandPanelDraft {
  text: string;
  sourceSessionId: string | null;
  sourceSessionType?: SessionType;
  dataType?: SendCommandDataType;
  sendMode: SendCommandMode;
  count: SendCommandCount;
  intervalSeconds: number;
  target: SendCommandTarget;
}

export function openSendCommandPanel(draft: SendCommandPanelDraft): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SendCommandPanelDraft>(OPEN_SEND_COMMAND_PANEL_EVENT, { detail: draft }),
  );
}

export function listenOpenSendCommandPanel(
  handler: (draft: SendCommandPanelDraft) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<SendCommandPanelDraft>;
    if (!customEvent.detail) return;
    handler(customEvent.detail);
  };

  window.addEventListener(OPEN_SEND_COMMAND_PANEL_EVENT, listener);
  return () => {
    window.removeEventListener(OPEN_SEND_COMMAND_PANEL_EVENT, listener);
  };
}
