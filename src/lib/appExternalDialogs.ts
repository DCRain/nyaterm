import type { TemporaryLinkConfig } from "@/lib/temporaryLink";
import type { SavedConnection } from "@/types/global";

export type ExternalConnectionChoice =
  | { kind: "saved"; connection: SavedConnection }
  | { kind: "temporary"; config: TemporaryLinkConfig }
  | { kind: "cancelled" };

export type ExternalMatchDialogState = {
  connections: SavedConnection[];
  temporary: TemporaryLinkConfig;
  resolve: (choice: ExternalConnectionChoice) => void;
};

export type PostLoginConfirmState = {
  connection: SavedConnection;
  command: string;
  resolve: (confirmed: boolean) => void;
};
