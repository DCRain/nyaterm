import type { EditorView } from "@codemirror/view";

function selectedText(view: EditorView) {
  const { from, to } = view.state.selection.main;
  return view.state.sliceDoc(from, to);
}

function replaceSelection(view: EditorView, text: string, cursorOffset?: number) {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: {
      anchor: from + (cursorOffset ?? text.length),
    },
    userEvent: "input",
  });
  view.focus();
}

/** Wrap selection (or insert placeholder) with before/after markers. */
export function wrapSelection(view: EditorView, before: string, after = before, placeholder = "") {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  if (selected) {
    const next = `${before}${selected}${after}`;
    view.dispatch({
      changes: { from, to, insert: next },
      selection: { anchor: from + before.length, head: from + before.length + selected.length },
      userEvent: "input",
    });
  } else {
    const insert = `${before}${placeholder}${after}`;
    view.dispatch({
      changes: { from, to, insert },
      selection: {
        anchor: from + before.length,
        head: from + before.length + placeholder.length,
      },
      userEvent: "input",
    });
  }
  view.focus();
}

function mapSelectedLines(view: EditorView, mapLine: (line: string, index: number) => string) {
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to === from ? from : to - (to > from ? 1 : 0));
  const lines: string[] = [];
  for (let number = startLine.number; number <= endLine.number; number += 1) {
    lines.push(view.state.doc.line(number).text);
  }
  const mapped = lines.map(mapLine).join("\n");
  view.dispatch({
    changes: { from: startLine.from, to: endLine.to, insert: mapped },
    selection: {
      anchor: startLine.from,
      head: startLine.from + mapped.length,
    },
    userEvent: "input",
  });
  view.focus();
}

export function toggleLinePrefix(view: EditorView, prefix: string) {
  mapSelectedLines(view, (line) => {
    if (line.startsWith(prefix)) return line.slice(prefix.length);
    if (/^\s*$/.test(line)) return `${prefix}${line}`;
    return `${prefix}${line}`;
  });
}

export function setHeading(view: EditorView, level: 1 | 2 | 3 | 4) {
  const marks = "#".repeat(level);
  mapSelectedLines(view, (line) => {
    const stripped = line.replace(/^#{1,6}\s+/, "");
    return `${marks} ${stripped || "Heading"}`;
  });
}

export function insertLink(view: EditorView) {
  const selected = selectedText(view) || "text";
  const insert = `[${selected}](url)`;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert },
    selection: {
      anchor: from + selected.length + 3,
      head: from + selected.length + 6,
    },
    userEvent: "input",
  });
  view.focus();
}

export function insertCodeBlock(view: EditorView) {
  const selected = selectedText(view);
  const body = selected || "code";
  const insert = `\n\`\`\`\n${body}\n\`\`\`\n`;
  replaceSelection(view, insert, selected ? insert.length : 5);
}

export function insertTable(view: EditorView) {
  replaceSelection(view, `\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n`);
}

export function insertHorizontalRule(view: EditorView) {
  replaceSelection(view, "\n---\n");
}

export function insertBulletList(view: EditorView) {
  toggleLinePrefix(view, "- ");
}

export function insertOrderedList(view: EditorView) {
  mapSelectedLines(view, (line, index) => {
    const stripped = line.replace(/^\d+\.\s+/, "").replace(/^[-*+]\s+/, "");
    return `${index + 1}. ${stripped}`;
  });
}

export function insertQuote(view: EditorView) {
  toggleLinePrefix(view, "> ");
}

export function insertInlineMath(view: EditorView) {
  wrapSelection(view, "$", "$", "E=mc^2");
}

export function insertBlockMath(view: EditorView) {
  const selected = selectedText(view) || "E = mc^2";
  const insert = `\n$$\n${selected}\n$$\n`;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert },
    selection: {
      anchor: from + 3,
      head: from + 3 + selected.length,
    },
    userEvent: "input",
  });
  view.focus();
}

export function insertTaskList(view: EditorView) {
  mapSelectedLines(view, (line) => {
    const stripped = line
      .replace(/^\d+\.\s+/, "")
      .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "")
      .replace(/^\[[ xX]\]\s+/, "");
    return `- [ ] ${stripped}`;
  });
}

function insertFencedBlock(view: EditorView, language: string, body: string) {
  const insert = `\n\`\`\`${language}\n${body}\n\`\`\`\n`;
  replaceSelection(view, insert);
}

export function insertMermaidFlowchart(view: EditorView) {
  insertFencedBlock(
    view,
    "mermaid",
    [
      "flowchart TD",
      "  A[Start] --> B{Decision}",
      "  B -->|Yes| C[OK]",
      "  B -->|No| D[Retry]",
    ].join("\n"),
  );
}

export function insertMermaidSequence(view: EditorView) {
  insertFencedBlock(
    view,
    "mermaid",
    [
      "sequenceDiagram",
      "  participant A as Client",
      "  participant B as Server",
      "  A->>B: Request",
      "  B-->>A: Response",
    ].join("\n"),
  );
}

export function insertMermaidGantt(view: EditorView) {
  insertFencedBlock(
    view,
    "mermaid",
    [
      "gantt",
      "  title Project Plan",
      "  dateFormat YYYY-MM-DD",
      "  section Phase 1",
      "  Design           :a1, 2026-01-01, 7d",
      "  Implementation   :after a1, 14d",
      "  section Phase 2",
      "  Testing          :2026-01-22, 7d",
    ].join("\n"),
  );
}

export function insertECharts(view: EditorView) {
  insertFencedBlock(
    view,
    "echarts",
    JSON.stringify(
      {
        title: { text: "Sample Chart" },
        tooltip: {},
        xAxis: { type: "category", data: ["A", "B", "C", "D"] },
        yAxis: { type: "value" },
        series: [{ type: "bar", data: [12, 24, 18, 32] }],
      },
      null,
      2,
    ),
  );
}
