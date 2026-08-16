const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})/;
const TABLE_DELIM_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

/**
 * True only for GFM table rows that sit inside a real table
 * (adjacent to a delimiter row). Plain "|" box-drawing lines are NOT tables.
 */
function buildTableLineFlags(lines: string[]): boolean[] {
  const flags = lines.map(() => false);
  for (let i = 0; i < lines.length; i++) {
    if (!TABLE_DELIM_RE.test(lines[i])) continue;
    flags[i] = true;
    let up = i - 1;
    while (up >= 0 && TABLE_ROW_RE.test(lines[up])) {
      flags[up] = true;
      up -= 1;
    }
    let down = i + 1;
    while (down < lines.length && TABLE_ROW_RE.test(lines[down])) {
      flags[down] = true;
      down += 1;
    }
  }
  return flags;
}

/**
 * Turn single newlines into Markdown hard breaks (two trailing spaces),
 * skipping fenced code and real GFM tables only.
 */
export function hardenMarkdownNewlines(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const tableFlags = buildTableLineFlags(lines);
  let inFence = false;
  let fenceMarker: string | null = null;
  const output: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
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
      output.push(line);
      continue;
    }

    if (inFence) {
      output.push(line);
      continue;
    }

    const nextIsBlank = next === undefined || next.trim() === "";
    const alreadyHard = / {2}$/.test(line) || /\\$/.test(line);
    const shouldHarden =
      next !== undefined && !nextIsBlank && !tableFlags[i] && line.trim() !== "" && !alreadyHard;

    output.push(shouldHarden ? `${line}  ` : line);
  }

  return output.join("\n");
}

const BOX_CHAR_RE = /[┌┐└┘├┤┬┴┼─│═╔╗╚╝║╒╓╕╖╘╙╛╜╞╟╡╢╤╥╧╨╪╫╬]/;

/** Lines that look like ASCII / box-drawing diagram rows. */
export function isAsciiArtLine(line: string): boolean {
  if (BOX_CHAR_RE.test(line)) return true;
  // Common ASCII borders that are NOT GFM tables (no delimiter nearby handled separately).
  if (/^\s*[+|].*[+|]\s*$/.test(line) && /[-+=]{3,}/.test(line)) return true;
  return false;
}

/**
 * Wrap consecutive ASCII-art lines in a text fence so preview keeps
 * monospace alignment and exact newlines.
 */
export function wrapAsciiDiagrams(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const tableFlags = buildTableLineFlags(lines);
  const output: string[] = [];
  let inFence = false;
  let fenceMarker: string | null = null;
  let i = 0;

  while (i < lines.length) {
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
      output.push(line);
      i += 1;
      continue;
    }

    if (inFence) {
      output.push(line);
      i += 1;
      continue;
    }

    if (!tableFlags[i] && isAsciiArtLine(line)) {
      const block: string[] = [];
      while (i < lines.length) {
        const current = lines[i];
        if (FENCE_RE.test(current)) break;
        if (tableFlags[i]) break;
        if (isAsciiArtLine(current)) {
          block.push(current);
          i += 1;
          continue;
        }
        // Allow a single blank line inside a diagram.
        if (
          current.trim() === "" &&
          i + 1 < lines.length &&
          !tableFlags[i + 1] &&
          isAsciiArtLine(lines[i + 1])
        ) {
          block.push(current);
          i += 1;
          continue;
        }
        break;
      }
      while (block.length > 0 && block[block.length - 1].trim() === "") {
        block.pop();
      }
      output.push("```text");
      output.push(...block);
      output.push("```");
      continue;
    }

    output.push(line);
    i += 1;
  }

  return output.join("\n");
}

/** Full note-preview preprocess: preserve diagrams + hard line breaks. */
export function prepareNoteMarkdownForPreview(markdown: string): string {
  return hardenMarkdownNewlines(wrapAsciiDiagrams(markdown));
}
