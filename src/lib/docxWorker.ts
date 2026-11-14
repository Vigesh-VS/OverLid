// Runs mammoth off the main thread so a hostile .docx can only hang or
// crash this worker, which the importer kills after a timeout. Images are
// never decoded: each one becomes an empty placeholder.

import mammoth from "mammoth/mammoth.browser.min.js";

export interface DocxRequest {
  buffer: ArrayBuffer;
}

export type DocxResponse = { ok: true; html: string; warnings: boolean } | { ok: false };

self.onmessage = async (e: MessageEvent<DocxRequest>) => {
  try {
    const result = await mammoth.convertToHtml(
      { arrayBuffer: e.data.buffer },
      { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })) },
    );
    const reply: DocxResponse = { ok: true, html: result.value, warnings: result.messages.some((m) => m.type === "warning") };
    self.postMessage(reply);
  } catch {
    self.postMessage({ ok: false } satisfies DocxResponse);
  }
};
