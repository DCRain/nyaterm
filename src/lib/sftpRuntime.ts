import type { SavedConnection } from "@/types/global";

export function canOpenSavedConnectionWithSftp(connection: SavedConnection) {
  return connection.type === "ssh" && connection.sftp?.enabled !== false;
}

export function openSavedConnectionWithSftp(
  connection: SavedConnection,
  onOpen: (connection: SavedConnection) => Promise<void> | void,
) {
  if (!canOpenSavedConnectionWithSftp(connection)) return false;
  void onOpen(connection);
  return true;
}
