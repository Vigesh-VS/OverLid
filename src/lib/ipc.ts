// Typed wrappers for every Tauri command and event. Keep this file in sync
// with the Rust side (src-tauri/src).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Logical px, relative to the island window's top-left. */
export interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const commands = {
  setHitRect: (rect: HitRect) => invoke<void>("set_hit_rect", { rect }),
};

export interface EventPayloads {
  /** Cursor entered (true) or left (false) the current hit rect. */
  "island://hover": boolean;
}

export function on<K extends keyof EventPayloads>(
  event: K,
  handler: (payload: EventPayloads[K]) => void,
): Promise<UnlistenFn> {
  return listen<EventPayloads[K]>(event, (e) => handler(e.payload));
}

/** True when running inside Tauri rather than a plain browser tab. */
export const inTauri = "__TAURI_INTERNALS__" in window;
