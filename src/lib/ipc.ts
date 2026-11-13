// Typed wrappers for every Tauri command and event. Keep this file in sync
// with the Rust side (src-tauri/src).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** True when running inside Tauri rather than a plain browser tab. */
export const inTauri = "__TAURI_INTERNALS__" in window;

// ---------- Island window ----------

/** Logical px, relative to the island window's top-left. */
export interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------- Media ----------

export interface MediaState {
  title: string;
  artist: string;
  album: string;
  sourceApp: string;
  sourceId: string;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  /** Unix ms when positionMs was sampled. */
  timelineAtMs: number;
  /** data: URL, when the player provides art. */
  art: string | null;
  sessionIndex: number;
  sessionCount: number;
}

// ---------- Commands ----------

export const commands = {
  setHitRect: (rect: HitRect) => invoke<void>("set_hit_rect", { rect }),

  mediaGet: () => invoke<MediaState | null>("media_get"),
  mediaPlayPause: () => invoke<void>("media_play_pause"),
  mediaNext: () => invoke<void>("media_next"),
  mediaPrevious: () => invoke<void>("media_previous"),
  mediaSeek: (positionMs: number) =>
    invoke<void>("media_seek", { positionMs: Math.max(0, Math.round(positionMs)) }),
  mediaCycleSession: () => invoke<void>("media_cycle_session"),
};

// ---------- Events ----------

export interface EventPayloads {
  /** Cursor entered (true) or left (false) the current hit rect. */
  "island://hover": boolean;
  "media://update": MediaState | null;
}

export function on<K extends keyof EventPayloads>(
  event: K,
  handler: (payload: EventPayloads[K]) => void,
): Promise<UnlistenFn> {
  return listen<EventPayloads[K]>(event, (e) => handler(e.payload));
}

/** Fire-and-forget a command, logging failures instead of throwing. */
export function run(promise: Promise<unknown>, what: string): void {
  promise.catch((e: unknown) => console.error(`${what} failed`, e));
}
