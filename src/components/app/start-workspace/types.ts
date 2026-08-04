import type { Group, SavedConnection } from "@/types/global";

export type StartWorkspaceMode = "workbench" | "assets";
export type AssetViewMode = "list" | "cards";
export type AssetFilterKey = "linux" | "windows" | "gpu" | "npu";
export type AssetSortKey = "name" | "address" | "cpu" | "memory" | "storage" | "accelerators";
export type AssetSortDirection = "asc" | "desc";

export interface AssetSortState {
  key: AssetSortKey;
  direction: AssetSortDirection;
}

export interface AssetRecord {
  connection: SavedConnection;
  groupPath: string;
  groupSortOrder: number;
  searchText: string;
}

export interface AssetGroupOption {
  group: Group;
  path: string;
  searchText: string;
}
