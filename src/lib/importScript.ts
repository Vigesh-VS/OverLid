// Turns .txt, .md, .docx and .pdf files into teleprompter scripts.
// Text only: paragraphs are kept, headings become "## " sections.
// Heavy parsers load on demand so they never slow down the island.
// Every file goes through importGuard first: real type by magic bytes,
// size caps, and a zip-bomb scan before a .docx is unpacked.

import { ImportError, LIMITS, capText, checkZip, decodeText, extension, sniff } from "./importGuard";
import type { DocxResponse } from "./docxWorker";

export { ImportError };

export interface ImportedScript {
  title: string;
  body: string;
  /** Non-fatal notes for the preview, e.g. "Images were skipped". */
  notes: string[];
}

export const IMPORT_ACCEPT = ".txt,.md,.markdown,.docx,.pdf";
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

/** Convert a .docx to HTML in a worker that's killed if it runs too long. */
function docxToHtml(buffer: ArrayBuffer): Promise<{ html: string; warnings: boolean }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./docxWorker.ts", import.meta.url), { type: "module" });
    const unreadable = new ImportError("This Word file couldn't be read. Save it as .docx again and retry.");
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new ImportError("This Word file took too long to read, so it was skipped."));
    }, LIMITS.docxMs);
    worker.onmessage = (e: MessageEvent<DocxResponse>) => {
      window.clearTimeout(timer);
      worker.terminate();
      if (e.data.ok) resolve({ html: e.data.html, warnings: e.data.warnings });
      else reject(unreadable);
    };
    worker.onerror = () => {
      window.clearTimeout(timer);
      worker.terminate();
      reject(unreadable);
    };
    worker.postMessage({ buffer }, [buffer]);
  });
}

async function fromDocx(buffer: ArrayBuffer, notes: string[]): Promise<string> {
  checkZip(new Uint8Array(buffer));
  const result = await docxToHtml(buffer);
  if (result.warnings) notes.push("Some Word formatting was simplified.");
  // An inert document: nothing in it runs or loads.
  const doc = new DOMParser().parseFromString(result.html, "text/html");
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

  const deadline = Date.now() + LIMITS.pdfMs;
  const tooSlow = new ImportError("This PDF took too long to read, so it was skipped.");
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    enableXfa: false,
  });
  // pdf.js parses in its own worker; destroying the task stops it.
  const timer = window.setTimeout(() => void task.destroy(), LIMITS.pdfMs);

  let pdf;
  try {
    pdf = await task.promise;
  } catch (e) {
    window.clearTimeout(timer);
    if (Date.now() >= deadline) throw tooSlow;
    const msg = String(e);
    if (/password/i.test(msg)) throw new ImportError("This PDF is password-protected. Remove the password and try again.");
    throw new ImportError("This PDF couldn't be read. It may be damaged.");
  }

  if (pdf.numPages > LIMITS.pdfPages) {
    window.clearTimeout(timer);
    await pdf.destroy();
    throw new ImportError(`This PDF has more than ${LIMITS.pdfPages} pages, which is too long for a script.`);
  }

  const paragraphs: string[] = [];
  let chars = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    if (Date.now() >= deadline) {
      window.clearTimeout(timer);
      await pdf.destroy();
      throw tooSlow;
    }
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
      chars += text.length;
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
    if (chars > LIMITS.textChars) {
      window.clearTimeout(timer);
      await pdf.destroy();
      throw new ImportError("That file has too much text for a script (over 2 MB).");
    }
  }
  window.clearTimeout(timer);
  await pdf.destroy();
  return paragraphs.join("\n\n");
}

export async function importFile(file: File): Promise<ImportedScript> {
  const ext = extension(file.name);
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const kind = sniff(file.name, file.size, head);

  const notes: string[] = [];
  let body: string;
  try {
    if (kind === "docx") body = await fromDocx(await file.arrayBuffer(), notes);
    else if (kind === "pdf") body = await fromPdf(await file.arrayBuffer());
    else {
      const text = decodeText(new Uint8Array(await file.arrayBuffer()));
      body = ext === "txt" ? text : fromMarkdown(text);
    }
  } catch (e) {
    if (e instanceof ImportError) throw e;
    console.error("import failed", e);
    throw new ImportError(
      ext === "docx" ? "This Word file couldn't be read. Save it as .docx again and retry." : "This file couldn't be read.",
    );
  }

  body = capText(tidy(body));
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
