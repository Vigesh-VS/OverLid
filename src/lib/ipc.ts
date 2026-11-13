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
    shortcuts: PrompterShortcuts;
  };
}

export interface PrompterShortcuts {
  toggle: string;
  playPause: string;
  faster: string;
  slower: string;
  bigger: string;
  smaller: string;
  prevSection: string;
  nextSection: string;
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

// ---------- Pomodoro ----------

export type PomoPhase = "focus" | "shortBreak" | "longBreak";

export interface DayStats {
  sessions: number;
  minutes: number;
}

export interface PomoState {
  phase: PomoPhase;
  running: boolean;
  remainingMs: number;
  totalMs: number;
  round: number;
  roundsPerCycle: number;
  today: DayStats;
}

// ---------- CodeNotch ----------

export interface UsageWindow {
  key: string;
  label: string;
  usedPercent: number;
  /** ISO-8601 */
  resetsAt: string | null;
}

export interface UsageSnapshot {
  windows: UsageWindow[];
  fetchedAt: string;
  fidelity: "derived";
}

export type UsageState = "loading" | "ok" | "needsAuth" | "rateLimited" | "error" | "disabled";

export interface ProviderStatus {
  providerId: string;
  displayName: string;
  state: UsageState;
  snapshot: UsageSnapshot | null;
  message: string | null;
  lastAttemptAt: string | null;
}

export type SessionStatus = "idle" | "busy" | "waiting" | "done";

export interface AgentSession {
  id: string;
  label: string;
  cwd: string;
  status: SessionStatus;
  message: string | null;
  tool: string | null;
  turnStartedAt: string | null;
  updatedAt: string;
}

export interface HookStatus {
  installed: boolean;
  partial: boolean;
  port: number | null;
  settingsPath: string | null;
  listeningPort: number | null;
}

export interface HookChangeReport {
  backup: string | null;
  status: HookStatus;
}

// ---------- Teleprompter ----------

export interface Script {
  id: string;
  title: string;
  body: string;
  favorite: boolean;
  updatedAt: string;
}

export type PrompterAction =
  | "toggle"
  | "playPause"
  | "faster"
  | "slower"
  | "bigger"
  | "smaller"
  | "prevSection"
  | "nextSection";

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

  pomoGet: () => invoke<PomoState | null>("pomo_get"),
  pomoStart: () => invoke<void>("pomo_start"),
  pomoPause: () => invoke<void>("pomo_pause"),
  pomoSkip: () => invoke<void>("pomo_skip"),
  pomoReset: () => invoke<void>("pomo_reset"),
  pomoHistory: () => invoke<Record<string, DayStats>>("pomo_history"),

  codeUsage: () => invoke<ProviderStatus[]>("code_usage"),
  codeRefreshUsage: () => invoke<void>("code_refresh_usage"),
  codeSessions: () => invoke<AgentSession[]>("code_sessions"),
  codeOpenFolder: (sessionId: string) => invoke<void>("code_open_folder", { sessionId }),
  codeHookStatus: () => invoke<HookStatus>("code_hook_status"),
  codeConnect: () => invoke<HookChangeReport>("code_connect"),
  codeDisconnect: () => invoke<HookChangeReport>("code_disconnect"),

  prompterSetActive: (active: boolean) => invoke<void>("prompter_set_active", { active }),
  scriptsList: () => invoke<Script[]>("scripts_list"),
  scriptCreate: (title?: string) => invoke<Script>("script_create", { title: title ?? null }),
  scriptSave: (script: Script) => invoke<Script>("script_save", { script }),
  scriptDelete: (id: string) => invoke<void>("script_delete", { id }),
  scriptDuplicate: (id: string) => invoke<Script>("script_duplicate", { id }),
  scriptImport: () => invoke<Script | null>("script_import"),
  scriptExport: (id: string) => invoke<boolean>("script_export", { id }),
  voiceStart: (device: string | null) => invoke<void>("voice_start", { device }),
  voiceStop: () => invoke<void>("voice_stop"),
  voiceDevices: () => invoke<string[]>("voice_devices"),

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
  "pomo://tick": PomoState;
  "code://usage": ProviderStatus[];
  "code://session": AgentSession[];
  "prompter://command": PrompterAction;
  "prompter://scripts": null;
  "voice://level": number;
  "voice://error": string;
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
