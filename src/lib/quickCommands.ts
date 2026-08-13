import type { QuickCommand, QuickCommandSortMode } from "@/types/global";

export function compareQuickCommandsByMode(
  left: QuickCommand,
  right: QuickCommand,
  sortMode: QuickCommandSortMode,
) {
  const pinDiff = (right.pinned ? 1 : 0) - (left.pinned ? 1 : 0);
  if (pinDiff !== 0) return pinDiff;

  switch (sortMode) {
    case "name":
      return left.label.localeCompare(right.label);
    case "useCount":
      return (
        (right.use_count ?? 0) - (left.use_count ?? 0) ||
        compareQuickCommandsByCreated(left, right)
      );
    case "custom":
      return (
        (left.sort_order ?? Number.MAX_SAFE_INTEGER) -
          (right.sort_order ?? Number.MAX_SAFE_INTEGER) ||
        compareQuickCommandsByCreated(left, right)
      );
    default:
      return compareQuickCommandsByCreated(left, right);
  }
}

export function reorderQuickCommandsWithinCategory(
  commands: QuickCommand[],
  sourceId: string,
  targetId: string,
  categoryId: string | null,
) {
  if (sourceId === targetId) return commands;

  const categoryCommands = commands
    .filter((command) => commandCategoryMatches(command, categoryId))
    .sort((left, right) => compareQuickCommandsByMode(left, right, "custom"));
  const sourceIndex = categoryCommands.findIndex(
    (command) => command.id === sourceId,
  );
  const targetIndex = categoryCommands.findIndex(
    (command) => command.id === targetId,
  );
  if (sourceIndex < 0 || targetIndex < 0) return commands;
  if (
    Boolean(categoryCommands[sourceIndex].pinned) !==
    Boolean(categoryCommands[targetIndex].pinned)
  ) {
    return commands;
  }

  const reordered = [...categoryCommands];
  const [source] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, source);

  const sortOrderById = new Map(
    reordered.map((command, sortOrder) => [command.id, sortOrder]),
  );

  return commands.map((command) =>
    sortOrderById.has(command.id)
      ? { ...command, sort_order: sortOrderById.get(command.id) }
      : command,
  );
}

function commandCategoryMatches(command: QuickCommand, categoryId: string | null) {
  return categoryId ? command.category_id === categoryId : !command.category_id;
}

function compareQuickCommandsByCreated(
  left: QuickCommand,
  right: QuickCommand,
) {
  return (
    (left.created_at ?? left.updated_at ?? Number.MAX_SAFE_INTEGER) -
      (right.created_at ?? right.updated_at ?? Number.MAX_SAFE_INTEGER) ||
    left.label.localeCompare(right.label) ||
    left.id.localeCompare(right.id)
  );
}
