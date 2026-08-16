import type { EditorView } from "@codemirror/view";

/** 1-based source line currently at the top of the editor viewport. */
export function getEditorTopLine(view: EditorView): number {
  const scrollTop = view.scrollDOM.scrollTop;
  const block = view.lineBlockAtHeight(scrollTop);
  return view.state.doc.lineAt(block.from).number;
}

/** Scroll preview so the block for `line` (1-based) sits near the top. */
export function scrollPreviewToSourceLine(preview: HTMLElement, line: number) {
  const nodes = preview.querySelectorAll<HTMLElement>("[data-source-line]");
  if (nodes.length === 0) return;

  let best: HTMLElement | null = null;
  let bestLine = -1;
  for (const node of nodes) {
    const sourceLine = Number(node.dataset.sourceLine);
    if (!Number.isFinite(sourceLine)) continue;
    if (sourceLine <= line && sourceLine >= bestLine) {
      best = node;
      bestLine = sourceLine;
    }
  }
  if (!best) best = nodes[0];

  const previewRect = preview.getBoundingClientRect();
  const bestRect = best.getBoundingClientRect();
  const nextTop = bestRect.top - previewRect.top + preview.scrollTop - 8;
  const max = Math.max(0, preview.scrollHeight - preview.clientHeight);
  preview.scrollTop = Math.min(max, Math.max(0, nextTop));
}

/** 1-based source line of the preview block nearest the viewport top. */
export function getPreviewTopSourceLine(preview: HTMLElement): number | null {
  const previewRect = preview.getBoundingClientRect();
  const nodes = preview.querySelectorAll<HTMLElement>("[data-source-line]");
  let bestLine: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const node of nodes) {
    const sourceLine = Number(node.dataset.sourceLine);
    if (!Number.isFinite(sourceLine)) continue;
    const rect = node.getBoundingClientRect();
    const dist = rect.top - previewRect.top;
    if (dist <= 12 && Math.abs(dist) <= bestDist) {
      bestDist = Math.abs(dist);
      bestLine = sourceLine;
    }
  }

  if (bestLine !== null) return bestLine;

  for (const node of nodes) {
    const sourceLine = Number(node.dataset.sourceLine);
    if (!Number.isFinite(sourceLine)) continue;
    const rect = node.getBoundingClientRect();
    if (rect.bottom > previewRect.top) return sourceLine;
  }
  return null;
}

/** Scroll editor so `line` (1-based) sits near the top. */
export function scrollEditorToLine(view: EditorView, line: number) {
  const safe = Math.min(Math.max(1, line), view.state.doc.lines);
  const lineInfo = view.state.doc.line(safe);
  const block = view.lineBlockAt(lineInfo.from);
  const max = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
  view.scrollDOM.scrollTop = Math.min(max, Math.max(0, block.top - 8));
}
