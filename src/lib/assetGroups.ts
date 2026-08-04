import type { Group, SavedConnection } from "@/types/global";

export interface AssetGroupPathSegment {
  id: string | null;
  name: string;
}

export const ASSET_ROOT_SEGMENT: AssetGroupPathSegment = {
  id: null,
  name: "assets.root",
};

export function buildGroupIndex(groups: Group[]): Map<string, Group> {
  const index = new Map<string, Group>();
  for (const group of groups) {
    if (!group.id || index.has(group.id)) continue;
    index.set(group.id, group);
  }
  return index;
}

export function buildGroupPath(
  groups: Group[],
  selectedGroupId: string | null | undefined,
): AssetGroupPathSegment[] {
  if (!selectedGroupId) return [ASSET_ROOT_SEGMENT];

  const groupsById = buildGroupIndex(groups);
  const segments: AssetGroupPathSegment[] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = selectedGroupId;

  while (currentId) {
    if (seen.has(currentId)) break;
    seen.add(currentId);

    const group = groupsById.get(currentId);
    if (!group) break;

    segments.push({ id: group.id, name: group.name });
    currentId = group.parent_id;
  }

  segments.reverse();
  return [ASSET_ROOT_SEGMENT, ...segments];
}

export function collectDescendantGroupIds(
  groups: Group[],
  selectedGroupId: string | null | undefined,
): Set<string> {
  const result = new Set<string>();
  if (!selectedGroupId) return result;

  const groupsById = buildGroupIndex(groups);
  if (!groupsById.has(selectedGroupId)) return result;

  const childrenByParent = new Map<string, string[]>();
  for (const group of groupsById.values()) {
    const parentId = group.parent_id;
    if (!parentId || !groupsById.has(parentId)) continue;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(group.id);
    childrenByParent.set(parentId, children);
  }

  const queue = [selectedGroupId];
  while (queue.length > 0) {
    const groupId = queue.shift();
    if (!groupId || result.has(groupId)) continue;
    result.add(groupId);
    queue.push(...(childrenByParent.get(groupId) ?? []));
  }

  return result;
}

export function getConnectionsForAssetGroup(
  connections: SavedConnection[],
  groups: Group[],
  selectedGroupId: string | null | undefined,
): SavedConnection[] {
  if (!selectedGroupId) return connections;

  const selectedIds = collectDescendantGroupIds(groups, selectedGroupId);
  if (selectedIds.size === 0) return [];

  return connections.filter(
    (connection) => !!connection.group_id && selectedIds.has(connection.group_id),
  );
}

export function getGroupPathLabel(
  groups: Group[],
  groupId: string | null | undefined,
  rootLabel: string,
): string {
  const path = buildGroupPath(groups, groupId);
  return path.map((segment) => (segment.id === null ? rootLabel : segment.name)).join(" / ");
}

export function isUngroupedConnection(connection: SavedConnection, groups: Group[]) {
  if (!connection.group_id) return true;
  return !buildGroupIndex(groups).has(connection.group_id);
}
