import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  type IParagraphOptions,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { invoke } from "@/lib/invoke";

export type NoteExportFormat = "markdown" | "docx" | "pdf" | "png";

const EXT_BY_FORMAT: Record<NoteExportFormat, string> = {
  markdown: "md",
  docx: "docx",
  pdf: "pdf",
  png: "png",
};

const FILTER_BY_FORMAT: Record<NoteExportFormat, { name: string; extensions: string[] }> = {
  markdown: { name: "Markdown", extensions: ["md", "markdown"] },
  docx: { name: "Word Document", extensions: ["docx"] },
  pdf: { name: "PDF", extensions: ["pdf"] },
  png: { name: "PNG Image", extensions: ["png"] },
};

export function sanitizeExportFileName(title: string, format: NoteExportFormat): string {
  const base = title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "note";
  return `${base}.${EXT_BY_FORMAT[format]}`;
}

export async function exportNoteContent(options: {
  title: string;
  markdown: string;
  format: NoteExportFormat;
  /** Preview root element for PDF/PNG capture. */
  previewElement?: HTMLElement | null;
}): Promise<string | null> {
  const { title, markdown, format, previewElement } = options;
  const path = await saveFileDialog({
    defaultPath: sanitizeExportFileName(title, format),
    filters: [FILTER_BY_FORMAT[format]],
  });
  if (!path) return null;

  if (format === "markdown") {
    await invoke("write_user_text_file", { path, content: markdown });
    return path;
  }

  if (format === "docx") {
    const bytes = await buildDocxBytes(title, markdown);
    await invoke("write_user_binary_file", { path, contents: Array.from(bytes) });
    return path;
  }

  if (!previewElement) {
    throw new Error("preview_required");
  }

  if (format === "png") {
    const dataUrl = await toPng(previewElement, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: getComputedStyle(previewElement).backgroundColor || "#ffffff",
    });
    const bytes = dataUrlToBytes(dataUrl);
    await invoke("write_user_binary_file", { path, contents: Array.from(bytes) });
    return path;
  }

  // PDF: rasterize preview then embed pages.
  const dataUrl = await toPng(previewElement, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: getComputedStyle(previewElement).backgroundColor || "#ffffff",
  });
  const pdfBytes = await buildPdfFromPngDataUrl(dataUrl);
  await invoke("write_user_binary_file", { path, contents: Array.from(pdfBytes) });
  return path;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function buildPdfFromPngDataUrl(dataUrl: string): Promise<Uint8Array> {
  const img = await loadImage(dataUrl);
  const pdf = new jsPDF({
    orientation: img.width >= img.height ? "landscape" : "portrait",
    unit: "pt",
    format: "a4",
  });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;
  const scale = Math.min(usableWidth / img.width, usableHeight / img.height, 1);
  const drawWidth = img.width * scale;

  // Slice tall images across multiple pages.
  const sliceHeightPx = usableHeight / scale;
  let offsetY = 0;
  let page = 0;
  while (offsetY < img.height) {
    if (page > 0) pdf.addPage();
    const slice = Math.min(sliceHeightPx, img.height - offsetY);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = Math.max(1, Math.floor(slice));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, offsetY, img.width, slice, 0, 0, img.width, slice);
    const sliceUrl = canvas.toDataURL("image/png");
    const sliceDrawHeight = slice * scale;
    pdf.addImage(sliceUrl, "PNG", margin, margin, drawWidth, sliceDrawHeight);
    offsetY += slice;
    page += 1;
    if (page > 50) break;
  }

  const buffer = pdf.output("arraybuffer");
  return new Uint8Array(buffer);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = src;
  });
}

async function buildDocxBytes(title: string, markdown: string): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 240 },
    }),
  ];

  const lines = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let inCode = false;
  let codeBuffer: string[] = [];

  const flushCode = () => {
    if (codeBuffer.length === 0) return;
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: codeBuffer.join("\n"),
            font: "Consolas",
            size: 18,
          }),
        ],
        spacing: { before: 120, after: 120 },
      }),
    );
    codeBuffer = [];
  };

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const headingLevel =
        level === 1
          ? HeadingLevel.HEADING_1
          : level === 2
            ? HeadingLevel.HEADING_2
            : level === 3
              ? HeadingLevel.HEADING_3
              : HeadingLevel.HEADING_4;
      children.push(
        new Paragraph({
          text: heading[2],
          heading: headingLevel,
          spacing: { before: 200, after: 120 },
        }),
      );
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const text = line.replace(/^\s*([-*+]|\d+\.)\s+/, "");
      children.push(
        new Paragraph({
          text: stripInlineMd(text),
          bullet: { level: 0 },
        }),
      );
      continue;
    }

    if (!line.trim()) {
      children.push(new Paragraph({ text: "" }));
      continue;
    }

    const opts: IParagraphOptions = {
      children: [new TextRun(stripInlineMd(line))],
      spacing: { after: 80 },
      alignment: AlignmentType.LEFT,
    };
    children.push(new Paragraph(opts));
  }

  flushCode();

  const doc = new Document({
    sections: [{ children }],
  });
  const blob = await Packer.toBlob(doc);
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

function stripInlineMd(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}
