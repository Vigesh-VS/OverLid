import assert from "node:assert/strict";
import { test } from "node:test";

import { ImportError, LIMITS, checkZip, decodeText, sniff } from "../src/lib/importGuard.ts";

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new TextEncoder().encode(s);

/** A minimal ZIP with one central-directory entry claiming the given sizes. */
function zip(entries: { packed: number; unpacked: number }[]): Uint8Array {
  const local = ascii("PK\x03\x04");
  const dir: number[] = [];
  for (const e of entries) {
    const h = new Uint8Array(46 + 1);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint32(20, e.packed, true);
    v.setUint32(24, e.unpacked, true);
    v.setUint16(28, 1, true); // name length
    h[46] = 0x61;
    dir.push(...h);
  }
  const eocd = new Uint8Array(22);
  const v = new DataView(eocd.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, entries.length, true);
  v.setUint16(10, entries.length, true);
  v.setUint32(12, dir.length, true);
  v.setUint32(16, local.length, true);
  return new Uint8Array([...local, ...dir, ...eocd]);
}

const refuses = (fn: () => unknown) => assert.throws(fn, ImportError);

test("a renamed .exe is refused whatever its extension", () => {
  const exe = bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00);
  for (const name of ["talk.pdf", "talk.docx", "talk.txt", "talk.md"]) refuses(() => sniff(name, 4096, exe));
});

test("the extension must match the content", () => {
  refuses(() => sniff("talk.pdf", 100, ascii("PK\x03\x04....")));
  refuses(() => sniff("talk.docx", 100, ascii("%PDF-1.7")));
  refuses(() => sniff("talk.txt", 100, ascii("%PDF-1.7")));
  assert.equal(sniff("talk.pdf", 100, ascii("%PDF-1.7")), "pdf");
  assert.equal(sniff("talk.docx", 100, ascii("PK\x03\x04....")), "docx");
  assert.equal(sniff("Talk.MD", 100, ascii("# Hello")), "text");
});

test("unsupported, empty and oversized files are refused", () => {
  refuses(() => sniff("run.exe", 100, ascii("hello")));
  refuses(() => sniff("talk.txt", 0, new Uint8Array()));
  refuses(() => sniff("talk.pdf", LIMITS.fileBytes + 1, ascii("%PDF-1.7")));
});

test("text must really be text", () => {
  assert.equal(decodeText(ascii("Hello, world")), "Hello, world");
  assert.equal(decodeText(bytes(0xef, 0xbb, 0xbf, 0x48, 0x69)), "Hi");
  assert.equal(decodeText(bytes(0xff, 0xfe, 0x48, 0x00, 0x69, 0x00)), "Hi");
  refuses(() => decodeText(bytes(0xc3, 0x28, 0xa0, 0xa1))); // invalid UTF-8
  refuses(() => decodeText(bytes(0x48, 0x00, 0x69))); // NUL byte
  refuses(() => decodeText(ascii("a".repeat(LIMITS.textChars + 1))));
});

test("zip bombs are refused before unpacking", () => {
  checkZip(zip([{ packed: 2000, unpacked: 8000 }, { packed: 500, unpacked: 900 }]));
  // One entry claiming 1 GB.
  refuses(() => checkZip(zip([{ packed: 1_000_000, unpacked: 1_000_000_000 }])));
  // Many entries that add up past the cap.
  refuses(() => checkZip(zip(Array.from({ length: 60 }, () => ({ packed: 1_000_000, unpacked: 1_000_000 })))));
  // A tiny entry that would expand 1000×.
  refuses(() => checkZip(zip([{ packed: 2_000, unpacked: 2_000_000 }])));
  // Too many entries.
  refuses(() => checkZip(zip(Array.from({ length: LIMITS.zipEntries + 1 }, () => ({ packed: 1, unpacked: 1 })))));
  // ZIP64 markers and garbage.
  refuses(() => checkZip(zip([{ packed: 0xffffffff, unpacked: 0xffffffff }])));
  refuses(() => checkZip(ascii("PK\x03\x04 not really a zip")));
});
