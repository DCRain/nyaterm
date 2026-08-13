import { describe, expect, it } from "vitest";
import type { QuickCommand } from "@/types/global";
import {
  compareQuickCommandsByMode,
  reorderQuickCommandsWithinCategory,
} from "./quickCommands";

describe("quickCommands", () => {
  it("sorts custom order within pinned and unpinned groups", () => {
    const commands = [
      command("unpinned-a", undefined, 0, false),
      command("pinned-b", undefined, 1, true),
      command("pinned-a", undefined, 0, true),
      command("unpinned-b", undefined, 1, false),
    ];

    const result = [...commands].sort((left, right) =>
      compareQuickCommandsByMode(left, right, "custom"),
    );

    expect(result.map((item) => item.id)).toEqual([
      "pinned-a",
      "pinned-b",
      "unpinned-a",
      "unpinned-b",
    ]);
  });

  it("falls back to created time when custom sort order is missing", () => {
    const commands = [
      command("later", undefined, undefined, false, 20),
      command("earlier", undefined, undefined, false, 10),
    ];

    const result = [...commands].sort((left, right) =>
      compareQuickCommandsByMode(left, right, "custom"),
    );

    expect(result.map((item) => item.id)).toEqual(["earlier", "later"]);
  });

  it("reorders only commands in the selected category", () => {
    const commands = [
      command("a", "cat", 0),
      command("b", "cat", 1),
      command("c", "other", 0),
    ];

    const result = reorderQuickCommandsWithinCategory(commands, "b", "a", "cat");

    expect(result.find((item) => item.id === "b")?.sort_order).toBe(0);
    expect(result.find((item) => item.id === "a")?.sort_order).toBe(1);
    expect(result.find((item) => item.id === "c")?.sort_order).toBe(0);
  });

  it("reorders uncategorized commands separately", () => {
    const commands = [
      command("a", undefined, 0),
      command("b", undefined, 1),
      command("c", "cat", 0),
    ];

    const result = reorderQuickCommandsWithinCategory(commands, "b", "a", null);

    expect(result.find((item) => item.id === "b")?.sort_order).toBe(0);
    expect(result.find((item) => item.id === "a")?.sort_order).toBe(1);
    expect(result.find((item) => item.id === "c")?.sort_order).toBe(0);
  });

  it("does not reorder across pinned groups", () => {
    const commands = [
      command("pinned", "cat", 0, true),
      command("normal", "cat", 0),
    ];

    const result = reorderQuickCommandsWithinCategory(
      commands,
      "normal",
      "pinned",
      "cat",
    );

    expect(result).toBe(commands);
  });
});

function command(
  id: string,
  categoryId?: string,
  sortOrder?: number,
  pinned = false,
  createdAt = 0,
): QuickCommand {
  return {
    id,
    label: id,
    command: "echo test",
    category_id: categoryId,
    sort_order: sortOrder,
    pinned,
    created_at: createdAt,
  };
}
