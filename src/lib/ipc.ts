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

// ---------- Settings ----------

export type CaptureMode = "always" | "prompterOnly" | "never";

export interface Settings {
  general: { monitor: string | null; hideFromCapture: CaptureMode };
  peeks: {
    lockKeys: boolean;
    battery: boolean;
    agent: boolean;
    usage: boolean;
    focus: boolean;
    sound: boolean;
  };
  focus: {
    focusMin: number;
    shortMin: number;
    longMin: number;
    longEvery: number;
    autoStartBreaks: boolean;
  };
  code: {
    enabled: boolean;
    pollSecs: number;
    port: number;
    warnPct: number;
    criticalPct: number;
  };
  prompter: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    color: string;
    speed: number;
    mirror: boolean;
    width: number;
    height: number;
    voice: boolean;
    voiceThreshold: number;
    micDevice: string | null;
    captureHintSeen: boolean;
  };
}

export interface MonitorInfo {
  name: string;
  primary: boolean;
  width: number;
  height: number;
}

export interface IslandFlags {
  paused: boolean;
  gameMode: boolean;
  fullscreen: boolean;
  prompter: boolean;
}

// ---------- System ----------

export interface Battery {
  percent: number;
  charging: boolean;
  onAc: boolean;
}

export interface SystemTick {
  cpuPercent: number;
  cpuCores: number;
  memUsed: number;
  memTotal: number;
  battery: Battery | null;
  uptimeSecs: number;
  diskFree: number | null;
  diskTotal: number | null;
}

export interface LockKeys {
  caps: boolean;
  num: boolean;
}

// ---------- Peeks ----------

export type PeekKind =
  | "capsLock"
  | "numLock"
  | "charging"
  | "onBattery"
  | "lowBattery"
  | "agentDone"
  | "agentWaiting"
  | "usage"
  | "quotaBack"
  | "focusDone";

export type Tone = "neutral" | "good" | "warn" | "critical";

export interface Peek {
  kind: PeekKind;
  tone: Tone;
  title: string;
  subtitle: string | null;
  value: number | null;
  badge: string | null;
  sound: boolean;
}

// ---------- Commands ----------

export const commands = {
  setHitRect: (rect: HitRect) => invoke<void>("set_hit_rect", { rect }),
  islandFlags: () => invoke<IslandFlags>("island_flags"),
  listMonitors: () => invoke<MonitorInfo[]>("list_monitors"),

  settingsGet: () => invoke<Settings>("settings_get"),
  settingsSet: (settings: Settings) => invoke<Settings>("settings_set", { settings }),

  systemGet: () => invoke<SystemTick>("system_get"),
  systemKeys: () => invoke<LockKeys>("system_keys"),
  systemSetStatsActive: (active: boolean) => invoke<void>("system_set_stats_active", { active }),

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
  "island://peek": Peek;
  "island://state": IslandFlags;
  "media://update": MediaState | null;
  "settings://changed": Settings;
  "system://tick": SystemTick;
  "system://keys": LockKeys;
  "fullscreen://changed": boolean;
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
