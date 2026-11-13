// Turns .txt, .md, .docx and .pdf files into teleprompter scripts.
// Text only: paragraphs are kept, headings become "## " sections.
// Heavy parsers load on demand so they never slow down the island.

export interface ImportedScript {
  title: string;
  body: string;
  /** Non-fatal notes for the preview, e.g. "Images were skipped". */
  notes: string[];
}

export class ImportError extends Error {}

export const IMPORT_ACCEPT = ".txt,.md,.markdown,.docx,.pdf";
const MAX_BYTES = 40 * 1024 * 1024;

function extension(name: string): string {
  return name.toLowerCase().split(".").pop() ?? "";
}

function titleFrom(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported script";
}

/** Collapse blank runs and trailing spaces so paragraphs stay paragraphs. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fromMarkdown(text: string): string {
  // Any heading level becomes a section.
  return text.replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, "## $1");
}

async function fromDocx(buffer: ArrayBuffer, notes: string[]): Promise<string> {
  const mammoth = (await import("mammoth/mammoth.browser.min.js")).default;
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
  if (result.messages.some((m) => m.type === "warning")) notes.push("Some Word formatting was simplified.");
  const doc = new DOMParser().parseFromString(result.value, "text/html");
  const out: string[] = [];
  let images = false;
  doc.body.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li").forEach((el) => {
    if (el.querySelector("img")) images = true;
    // Skip paragraphs nested in list items; the <li> already has their text.
    if (el.tagName === "P" && el.closest("li")) return;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) return;
    out.push(/^H[1-6]$/.test(el.tagName) ? `## ${text}` : text);
  });
  if (images) notes.push("Images were skipped; only text is imported.");
  return out.join("\n\n");
}

interface PdfItem {
  str: string;
  transform: number[];
  height: number;
  hasEOL?: boolean;
}

async function fromPdf(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  } catch (e) {
    const msg = String(e);
    if (/password/i.test(msg)) throw new ImportError("This PDF is password-protected. Remove the password and try again.");
    throw new ImportError("This PDF couldn't be read. It may be damaged.");
  }

  const paragraphs: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    // Text items have `str`; marked-content items don't.
    const items = content.items.filter((i) => "str" in i) as unknown as PdfItem[];

    // Group items into lines by baseline, then lines into paragraphs by gaps.
    const lines: { y: number; h: number; text: string }[] = [];
    for (const item of items) {
      const y = item.transform[5];
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - y) < Math.max(2, item.height * 0.4)) {
        last.text += item.str;
      } else {
        lines.push({ y, h: item.height || 10, text: item.str });
      }
    }
    let current: string[] = [];
    const flush = () => {
      const text = current.join(" ").replace(/\s+/g, " ").trim();
      if (text) paragraphs.push(text);
      current = [];
    };
    lines.forEach((line, i) => {
      const prev = lines[i - 1];
      const gap = prev ? prev.y - line.y : 0;
      if (prev && (gap > prev.h * 1.7 || gap < 0)) flush();
      current.push(line.text);
    });
    flush();
    page.cleanup();
  }
  await pdf.destroy();
  return paragraphs.join("\n\n");
}

export async function importFile(file: File): Promise<ImportedScript> {
  const ext = extension(file.name);
  if (!["txt", "md", "markdown", "docx", "pdf"].includes(ext)) {
    throw new ImportError("That file type isn't supported. Use .txt, .md, .docx or .pdf.");
  }
  if (file.size === 0) throw new ImportError("That file is empty.");
  if (file.size > MAX_BYTES) throw new ImportError("That file is too large to import (over 40 MB).");

  const notes: string[] = [];
  let body: string;
  try {
    if (ext === "docx") body = await fromDocx(await file.arrayBuffer(), notes);
    else if (ext === "pdf") body = await fromPdf(await file.arrayBuffer());
    else {
      const text = await file.text();
      body = ext === "txt" ? text : fromMarkdown(text);
    }
  } catch (e) {
    if (e instanceof ImportError) throw e;
    console.error("import failed", e);
    throw new ImportError(
      ext === "docx" ? "This Word file couldn't be read. Save it as .docx again and retry." : "This file couldn't be read.",
    );
  }

  body = tidy(body);
  if (body.replace(/^## .*$/gm, "").trim().length < 20) {
    throw new ImportError(
      ext === "pdf"
        ? "No text found. This PDF looks like a scan or images only; Overlid can only import PDFs with selectable text."
        : "No text found in that file.",
    );
  }
  return { title: titleFrom(file.name), body, notes };
}

/** First supported file from a drop event, if any. */
export function droppedFile(e: DragEvent | React.DragEvent): File | null {
  const files = Array.from(e.dataTransfer?.files ?? []);
  return files.find((f) => ["txt", "md", "markdown", "docx", "pdf"].includes(extension(f.name))) ?? files[0] ?? null;
}
