// Checks every imported file before a parser sees it. The extension is
// never trusted: the first bytes decide what a file is, sizes are capped,
// and a .docx's ZIP directory is scanned for zip bombs before unpacking.
// Pure functions only, so they run under `node --test`.

export class ImportError extends Error {}

export const LIMITS = {
  /** Largest file accepted, before reading. */
  fileBytes: 20 * 1024 * 1024,
  /** Most text kept from any file. */
  textChars: 2 * 1024 * 1024,
  pdfPages: 500,
  /** Total unpacked size a .docx may claim. */
  zipUnpacked: 50 * 1024 * 1024,
  zipEntries: 2000,
  /** Highest packed-to-unpacked ratio for one large entry. */
  zipRatio: 200,
  /** How long the Word parser may run. */
  docxMs: 10_000,
} as const;

export type FileKind = "text" | "docx" | "pdf";

const EXTENSIONS: Record<string, FileKind> = { txt: "text", md: "text", markdown: "text", docx: "docx", pdf: "pdf" };

export function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"
const MZ = [0x4d, 0x5a]; // Windows programs
const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

/** What the file really is, judged by its bytes and its extension together. */
export function sniff(name: string, size: number, head: Uint8Array): FileKind {
  const kind = EXTENSIONS[extension(name)];
  if (!kind) throw new ImportError("That file type isn't supported. Use .txt, .md, .docx or .pdf.");
  if (size === 0) throw new ImportError("That file is empty.");
  if (size > LIMITS.fileBytes) throw new ImportError("That file is too large to import (over 20 MB).");

  const mismatch = new ImportError(`That file isn't really a .${extension(name)} file, so it wasn't opened.`);
  if (startsWith(head, MZ)) throw mismatch;
  if (kind === "pdf" && !startsWith(head, PDF)) throw mismatch;
  if (kind === "docx" && !startsWith(head, ZIP)) throw mismatch;
  if (kind === "text" && (startsWith(head, PDF) || startsWith(head, ZIP))) throw mismatch;
  return kind;
}

/**
 * Plain text in UTF-8 (with or without BOM) or UTF-16 with a BOM. Anything
 * that isn't valid text (binary data, NUL bytes) is refused.
 */
export function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    if (startsWith(bytes, UTF16LE_BOM)) text = new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
    else if (startsWith(bytes, UTF16BE_BOM)) text = new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2));
    else text = new TextDecoder("utf-8", { fatal: true }).decode(startsWith(bytes, UTF8_BOM) ? bytes.subarray(3) : bytes);
  } catch {
    throw new ImportError("That file isn't plain text (UTF-8 or UTF-16), so it wasn't opened.");
  }
  if (text.includes("\u0000")) throw new ImportError("That file looks like binary data, not text.");
  return capText(text);
}

/** Keep at most `LIMITS.textChars` characters. */
export function capText(text: string): string {
  if (text.length <= LIMITS.textChars) return text;
  throw new ImportError("That file has too much text for a script (over 2 MB).");
}

/**
 * Read a ZIP's central directory without unpacking anything and refuse
 * archives that would unpack too large, have too many entries, or use
 * ZIP64 (a .docx never needs it).
 */
export function checkZip(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bad = new ImportError("This Word file looks damaged or unsafe, so it wasn't opened.");
  // End of central directory: 22 bytes plus up to 64 KB of comment.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad;
  const entries = view.getUint16(eocd + 10, true);
  const dirSize = view.getUint32(eocd + 12, true);
  const dirStart = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || dirStart === 0xffffffff || dirSize === 0xffffffff) throw bad;
  if (entries > LIMITS.zipEntries) throw bad;
  if (dirStart + dirSize > eocd) throw bad;

  let at = dirStart;
  let unpacked = 0;
  for (let n = 0; n < entries; n++) {
    if (at + 46 > eocd || view.getUint32(at, true) !== 0x02014b50) throw bad;
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    if (packed === 0xffffffff || size === 0xffffffff) throw bad;
    if (size > 1024 * 1024 && size > Math.max(packed, 1) * LIMITS.zipRatio) throw bad;
    unpacked += size;
    if (unpacked > LIMITS.zipUnpacked) throw bad;
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
}
