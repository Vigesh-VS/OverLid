import { create } from "zustand";

import type { ClipItem } from "../lib/ipc";

interface ClipboardStore {
  items: ClipItem[];
  setItems: (items: ClipItem[]) => void;
}

export const useClipboard = create<ClipboardStore>((set) => ({
  items: [],
  setItems: (items) => set({ items }),
}));

const thumbCache = new Map<number, string>();

/** RGBA thumbnail from Rust → PNG data URL (cached per item). */
export function thumbUrl(item: ClipItem): string | null {
  if (!item.thumb || !item.thumbWidth || !item.thumbHeight) return null;
  const cached = thumbCache.get(item.id);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = item.thumbWidth;
  canvas.height = item.thumbHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const bytes = Uint8ClampedArray.from(atob(item.thumb), (c) => c.charCodeAt(0));
  ctx.putImageData(new ImageData(bytes, item.thumbWidth, item.thumbHeight), 0, 0);
  const url = canvas.toDataURL("image/png");
  thumbCache.set(item.id, url);
  return url;
}
