import type { IDisposable, Terminal } from "@xterm/xterm";
import type { SessionType } from "@/types/global";

export const REMOTE_COLOR_OSC_IDS = [4, 10, 11, 12, 104, 110, 111, 112] as const;
const DEFAULT_BACKGROUND_OSC_ID = 11;

const NOOP_DISPOSABLE: IDisposable = {
  dispose: () => undefined,
};

interface RemoteColorOscGuardOptions {
  blockDefaultBackground?: boolean;
}

export function installRemoteColorOscGuard(
  terminal: Terminal,
  sessionType: SessionType,
  onBlocked?: (oscId: number, data: string) => void,
  options: RemoteColorOscGuardOptions = {},
): IDisposable {
  const blockedOscIds = new Set<number>();

  if (sessionType === "Serial") {
    for (const oscId of REMOTE_COLOR_OSC_IDS) {
      blockedOscIds.add(oscId);
    }
  }

  if (options.blockDefaultBackground) {
    blockedOscIds.add(DEFAULT_BACKGROUND_OSC_ID);
  }

  if (blockedOscIds.size === 0) {
    return NOOP_DISPOSABLE;
  }

  const disposables = Array.from(blockedOscIds).map((oscId) =>
    terminal.parser.registerOscHandler(oscId, (data) => {
      onBlocked?.(oscId, data);
      return true;
    }),
  );

  return {
    dispose() {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    },
  };
}
