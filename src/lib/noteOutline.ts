export interface NoteOutlineItem {
  /** 1-based source line of the heading. */
  line: number;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})/;
const ATX_HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/** Extract ATX headings for the note outline, skipping fenced code. */
export function extractNoteOutline(markdown: string): NoteOutlineItem[] {
  const lines = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const items: NoteOutlineItem[] = [];
  let inFence = false;
  let fenceMarker: string | null = null;

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

    const match = ATX_HEADING_RE.exec(line);
    if (!match) continue;
    const level = match[1].length as NoteOutlineItem["level"];
    const text = match[2].trim();
    if (!text) continue;
    items.push({ line: i + 1, level, text });
  }

  return items;
}

/** Outline item whose heading line is at or above `line` (1-based). */
export function resolveActiveOutlineLine(
  items: NoteOutlineItem[],
  line: number | null | undefined,
): number | null {
  if (line == null || items.length === 0) return null;
  let active: number | null = null;
  for (const item of items) {
    if (item.line <= line) active = item.line;
    else break;
  }
  return active;
}
