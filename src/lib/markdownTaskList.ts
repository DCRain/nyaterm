/** Match GFM task-list markers: `- [ ]`, `* [x]`, `1. [X]`, indented variants. */
const TASK_ITEM_RE = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[([ xX])\]/;
const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})/;

function mapTaskLines(
  markdown: string,
  visit: (line: string, prefix: string) => string | null,
): { markdown: string; count: number; changed: boolean } {
  const lines = markdown.split("\n");
  let inFence = false;
  let fenceMarker: string | null = null;
  let count = 0;
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[2][0];
      const length = fence[2].length;
      if (!inFence) {
        inFence = true;
        fenceMarker = marker.repeat(length);
      } else if (
        fenceMarker &&
        fence[2].startsWith(fenceMarker[0]) &&
        fence[2].length >= fenceMarker.length
      ) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }
    if (inFence) continue;

    const match = TASK_ITEM_RE.exec(line);
    if (!match) continue;
    count += 1;
    const replacement = visit(line, match[1]);
    if (replacement !== null) {
      lines[i] = replacement;
      changed = true;
    }
  }

  return { markdown: changed ? lines.join("\n") : markdown, count, changed };
}

/**
 * Toggle the Nth GFM task checkbox in markdown source (0-based, document order).
 * Skips fenced code blocks so indices match the preview renderer.
 */
export function toggleMarkdownTaskAtIndex(
  markdown: string,
  index: number,
  checked: boolean,
): string {
  if (index < 0 || !Number.isFinite(index)) return markdown;

  let current = 0;
  const { markdown: next } = mapTaskLines(markdown, (line, prefix) => {
    if (current++ !== index) return null;
    return line.replace(TASK_ITEM_RE, `${prefix}[${checked ? "x" : " "}]`);
  });
  return next;
}

/** Count GFM task checkboxes outside fenced code blocks. */
export function countMarkdownTasks(markdown: string): number {
  return mapTaskLines(markdown, () => null).count;
}
