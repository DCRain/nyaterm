import type { TemporaryLinkConfig } from "@/lib/temporaryLink";
import type { SavedConnection, SshRuntimeMode } from "@/types/global";

export type ExternalConnectionChoice =
  | {
      kind: "saved";
      connection: SavedConnection;
      runtimeModeOverride?: SshRuntimeMode;
    }
  | { kind: "temporary"; config: TemporaryLinkConfig }
  | { kind: "cancelled" };

export type ExternalMatchDialogState = {
  connections: SavedConnection[];
  temporary: TemporaryLinkConfig;
  runtimeModeOverride?: SshRuntimeMode;
  resolve: (choice: ExternalConnectionChoice) => void;
};

export type PostLoginConfirmState = {
  connection: SavedConnection;
  command: string;
  resolve: (confirmed: boolean) => void;
};
