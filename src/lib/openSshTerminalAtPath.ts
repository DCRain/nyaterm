export const OPEN_SSH_TERMINAL_AT_PATH_EVENT = "nyaterm:open-ssh-terminal-at-path";

export type OpenSshTerminalAtPathDetail = {
  connectionId: string;
  path: string;
};

export function openSshTerminalAtPath(connectionId: string, path: string) {
  const trimmedPath = path.trim();
  const trimmedConnectionId = connectionId.trim();
  if (!trimmedConnectionId || !trimmedPath) return;
  window.dispatchEvent(
    new CustomEvent<OpenSshTerminalAtPathDetail>(OPEN_SSH_TERMINAL_AT_PATH_EVENT, {
      detail: { connectionId: trimmedConnectionId, path: trimmedPath },
    }),
  );
}

export function subscribeOpenSshTerminalAtPath(
  listener: (detail: OpenSshTerminalAtPathDetail) => void,
): () => void {
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<OpenSshTerminalAtPathDetail>;
    if (!customEvent.detail?.connectionId || !customEvent.detail?.path) return;
    listener(customEvent.detail);
  };
  window.addEventListener(OPEN_SSH_TERMINAL_AT_PATH_EVENT, handler);
  return () => window.removeEventListener(OPEN_SSH_TERMINAL_AT_PATH_EVENT, handler);
}
