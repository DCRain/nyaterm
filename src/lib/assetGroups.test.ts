import { describe, expect, it } from "vitest";
import type { Group, SavedConnection } from "@/types/global";
import {
  buildGroupPath,
  collectDescendantGroupIds,
  getConnectionsForAssetGroup,
} from "./assetGroups";

describe("assetGroups", () => {
  it("builds a three-level breadcrumb", () => {
    expect(buildGroupPath(groups(), "dev").map((segment) => segment.name)).toEqual([
      "assets.root",
      "Nanjing",
      "R&D",
      "Dev",
    ]);
  });

  it("returns the root path when no group is selected", () => {
    expect(buildGroupPath(groups(), null)).toEqual([{ id: null, name: "assets.root" }]);
  });

  it("does not crash when parent_id is missing", () => {
    expect(buildGroupPath([...groups(), group("orphan", "Orphan", "missing")], "orphan")).toEqual([
      { id: null, name: "assets.root" },
      { id: "orphan", name: "Orphan" },
    ]);
  });

  it("does not loop forever for circular parent references", () => {
    const circularGroups = [group("a", "A", "b"), group("b", "B", "a")];
    expect(buildGroupPath(circularGroups, "a").map((segment) => segment.name)).toEqual([
      "assets.root",
      "B",
      "A",
    ]);
  });

  it("includes descendant connections for a selected parent group", () => {
    const result = getConnectionsForAssetGroup(
      [connection("root", "root"), connection("dev", "dev"), connection("other", "other")],
      groups(),
      "root",
    );
    expect(result.map((item) => item.id)).toEqual(["root", "dev"]);
  });

  it("keeps ungrouped connections only in the root view", () => {
    const connections = [connection("ungrouped", undefined), connection("dev", "dev")];
    expect(getConnectionsForAssetGroup(connections, groups(), null).map((item) => item.id)).toEqual([
      "ungrouped",
      "dev",
    ]);
    expect(getConnectionsForAssetGroup(connections, groups(), "root").map((item) => item.id)).toEqual([
      "dev",
    ]);
  });

  it("collects descendants without including unrelated groups", () => {
    expect([...collectDescendantGroupIds(groups(), "root")].sort()).toEqual(["dev", "rd", "root"]);
  });
});

function groups(): Group[] {
  return [
    group("root", "Nanjing", undefined, 0),
    group("rd", "R&D", "root", 0),
    group("dev", "Dev", "rd", 0),
    group("other", "Other", undefined, 1),
  ];
}

function group(id: string, name: string, parentId?: string, sortOrder = 0): Group {
  return { id, name, parent_id: parentId, sort_order: sortOrder };
}

function connection(id: string, groupId?: string): SavedConnection {
  return {
    id,
    name: id,
    type: "ssh",
    host: "example.com",
    port: 22,
    username: "root",
    group_id: groupId,
  };
}
