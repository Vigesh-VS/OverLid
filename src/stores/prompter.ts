import { create } from "zustand";

import { commands, run, type PrompterAction, type Script, type VoiceStatus } from "../lib/ipc";
import { useSystem } from "./system";

export type PrompterStatus = "idle" | "countdown" | "presenting";

const RATE_STEP = 1.12;
const SIZE_STEP = 2;

/**
 * Latest mic level, kept outside React so 33 updates a second never
 * re-render anything. The scroll engine reads it every animation frame.
 */
export const voiceLevel = { level: 0, at: 0 };

interface PrompterStore {
  status: PrompterStatus;
  count: number;
  scripts: Script[];
  selectedId: string | null;
  script: Script | null;
  hardPaused: boolean;
  /** Reached the end of the script. */
  ended: boolean;
  /** Multiplier from the faster/slower shortcuts, applied to every timing mode. */
  rate: number;
  fontSize: number;
  voiceStatus: VoiceStatus | null;
  /** The user switched to auto-scroll for this run because the mic failed. */
  forceAuto: boolean;
  /** Live area size while dragging the prompter edges. */
  area: { width: number; height: number } | null;
  /** Bumped to ask the view to jump; `dir` is -1 (previous) or +1 (next). */
  jump: { dir: -1 | 1; nonce: number } | null;

  setScripts: (scripts: Script[]) => void;
  select: (id: string) => void;
  start: (script?: Script) => void;
  stop: () => void;
  togglePause: () => void;
  setEnded: (ended: boolean) => void;
  setVoiceStatus: (status: VoiceStatus) => void;
  switchToAutoScroll: () => void;
  setArea: (area: { width: number; height: number } | null) => void;
  handle: (action: PrompterAction) => void;
}

let countdownTimer: number | undefined;

export const usePrompter = create<PrompterStore>((set, get) => ({
  status: "idle",
  count: 3,
  scripts: [],
  selectedId: null,
  script: null,
  hardPaused: false,
  ended: false,
  rate: 1,
  fontSize: 28,
  voiceStatus: null,
  forceAuto: false,
  area: null,
  jump: null,

  setScripts: (scripts) =>
    set((s) => ({
      scripts,
      selectedId: scripts.some((x) => x.id === s.selectedId) ? s.selectedId : (scripts[0]?.id ?? null),
    })),

  select: (id) => set({ selectedId: id }),

  start: (script) => {
    const s = get();
    const chosen = script ?? s.scripts.find((x) => x.id === s.selectedId) ?? s.scripts[0];
    if (!chosen || s.status !== "idle") return;
    const prefs = useSystem.getState().settings?.prompter;
    window.clearInterval(countdownTimer);
    voiceLevel.level = 0;
    voiceLevel.at = 0;
    set({
      status: "countdown",
      count: 3,
      script: chosen,
      selectedId: chosen.id,
      hardPaused: false,
      ended: false,
      rate: 1,
      fontSize: prefs?.fontSize ?? 28,
      voiceStatus: null,
      forceAuto: false,
      area: null,
      jump: null,
    });
    // Protection and shortcuts go live with the countdown; the mic warms up during it.
    run(commands.prompterSetActive(true), "prompter_set_active");
    if (prefs?.voice) run(commands.voiceStart("prompter", prefs.micDevice), "voice_start");

    countdownTimer = window.setInterval(() => {
      const { count, status } = get();
      if (status !== "countdown") {
        window.clearInterval(countdownTimer);
        return;
      }
      if (count <= 1) {
        window.clearInterval(countdownTimer);
        set({ status: "presenting" });
      } else {
        set({ count: count - 1 });
      }
    }, 1000);
  },

  stop: () => {
    const s = get();
    if (s.status === "idle") return;
    window.clearInterval(countdownTimer);
    set({ status: "idle", script: null, area: null, voiceStatus: null });
    run(commands.prompterSetActive(false), "prompter_set_active");
    run(commands.voiceStop("prompter"), "voice_stop");

    // Remember speed and size changes made with the shortcuts.
    const settings = useSystem.getState().settings;
    if (!settings) return;
    const p = settings.prompter;
    const changes: Partial<typeof p> = {};
    if (p.fontSize !== s.fontSize) changes.fontSize = s.fontSize;
    if (s.rate !== 1) {
      if (p.timingMode === "speed") changes.speed = Math.round(p.speed * s.rate);
      if (p.timingMode === "lines") changes.linesPerMinute = Math.round(p.linesPerMinute * s.rate);
      if (p.timingMode === "duration") changes.durationMin = Math.round((p.durationMin / s.rate) * 10) / 10;
    }
    if (Object.keys(changes).length) {
      run(commands.settingsSet({ ...settings, prompter: { ...p, ...changes } }), "settings_set");
    }
  },

  togglePause: () =>
    set((s) => (s.ended ? { ended: false, hardPaused: false } : { hardPaused: !s.hardPaused })),

  setEnded: (ended) => set(ended ? { ended, hardPaused: true } : { ended }),

  setVoiceStatus: (voiceStatus) => {
    if (voiceStatus.owner === "prompter") set({ voiceStatus });
  },

  switchToAutoScroll: () => {
    set({ forceAuto: true });
    run(commands.voiceStop("prompter"), "voice_stop");
  },

  setArea: (area) => set({ area }),

  handle: (action) => {
    const s = get();
    if (action === "stop") {
      s.stop();
      return;
    }
    if (action === "toggle") {
      if (s.status === "idle") s.start();
      else s.stop();
      return;
    }
    if (s.status === "idle") return;
    switch (action) {
      case "playPause":
        s.togglePause();
        break;
      case "faster":
        set({ rate: Math.min(6, s.rate * RATE_STEP) });
        break;
      case "slower":
        set({ rate: Math.max(0.15, s.rate / RATE_STEP) });
        break;
      case "bigger":
        set({ fontSize: Math.min(72, s.fontSize + SIZE_STEP) });
        break;
      case "smaller":
        set({ fontSize: Math.max(14, s.fontSize - SIZE_STEP) });
        break;
      case "prevSection":
        set({ jump: { dir: -1, nonce: Date.now() } });
        break;
      case "nextSection":
        set({ jump: { dir: 1, nonce: Date.now() } });
        break;
    }
  },
}));

export type Block = { kind: "section"; text: string; index: number } | { kind: "para"; text: string };

/**
 * Script text → blocks. Any markdown heading is a section; blank lines
 * separate paragraphs. Markdown-only syntax that would read out as noise
 * (code fences, table rules, image links, HTML tags, quote markers) is
 * dropped; inline styling is kept for `renderInline`.
 */
export function parseScript(body: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let sections = 0;
  const flush = () => {
    if (para.length) blocks.push({ kind: "para", text: para.join(" ") });
    para = [];
  };
  for (const raw of body.split(/\r?\n/)) {
    let line = raw.trim();
    if (/^(```|~~~)/.test(line) || /^\|?\s*:?-{3,}/.test(line) || /^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "section", text: plainText(heading[1]), index: sections++ });
      continue;
    }
    if (line === "") {
      flush();
      continue;
    }
    line = line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/^>\s?/, "")
      .replace(/^[-*+]\s+/, "• ")
      .replace(/^\|(.*)\|$/, "$1")
      .replace(/\s*\|\s*/g, "  ·  ");
    if (line.trim()) para.push(line.trim());
  }
  flush();
  return blocks;
}

/** Markdown inline syntax stripped to plain text (for section names). */
export function plainText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/** Effective text size: fixed, or scaled with the area when auto-fit is on. */
export function effectiveFontSize(fontSize: number, width: number, autoFit: boolean): number {
  if (!autoFit) return fontSize;
  return Math.round(fontSize * Math.min(2, Math.max(0.5, width / 560)));
}
