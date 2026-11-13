import { create } from "zustand";

import { commands, run, type PrompterAction, type Script } from "../lib/ipc";
import { useSystem } from "./system";

export type PrompterStatus = "idle" | "countdown" | "presenting";

const SPEED_STEP = 1.15;
const SIZE_STEP = 2;

interface PrompterStore {
  status: PrompterStatus;
  count: number;
  scripts: Script[];
  selectedId: string | null;
  script: Script | null;
  hardPaused: boolean;
  /** Reached the end of the script. */
  ended: boolean;
  speed: number;
  fontSize: number;
  level: number;
  voiceError: string | null;
  /** Bumped to ask the view to jump; `dir` is -1 (previous) or +1 (next). */
  jump: { dir: -1 | 1; nonce: number } | null;

  setScripts: (scripts: Script[]) => void;
  select: (id: string) => void;
  start: (script?: Script) => void;
  stop: () => void;
  togglePause: () => void;
  setEnded: (ended: boolean) => void;
  setLevel: (level: number) => void;
  setVoiceError: (error: string | null) => void;
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
  speed: 60,
  fontSize: 28,
  level: 0,
  voiceError: null,
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
    set({
      status: "countdown",
      count: 3,
      script: chosen,
      selectedId: chosen.id,
      hardPaused: false,
      ended: false,
      speed: prefs?.speed ?? 60,
      fontSize: prefs?.fontSize ?? 28,
      level: 0,
      voiceError: null,
      jump: null,
    });
    // Protection and shortcuts go live with the countdown.
    run(commands.prompterSetActive(true), "prompter_set_active");
    if (prefs?.voice) run(commands.voiceStart(prefs.micDevice), "voice_start");

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
    set({ status: "idle", script: null, level: 0 });
    run(commands.prompterSetActive(false), "prompter_set_active");
    run(commands.voiceStop(), "voice_stop");

    // Remember speed and size changes made with the shortcuts.
    const settings = useSystem.getState().settings;
    if (settings && (settings.prompter.speed !== s.speed || settings.prompter.fontSize !== s.fontSize)) {
      run(
        commands.settingsSet({
          ...settings,
          prompter: { ...settings.prompter, speed: Math.round(s.speed), fontSize: s.fontSize },
        }),
        "settings_set",
      );
    }
  },

  togglePause: () =>
    set((s) => (s.ended ? { ended: false, hardPaused: false } : { hardPaused: !s.hardPaused })),

  setEnded: (ended) => set(ended ? { ended, hardPaused: true } : { ended }),

  setLevel: (level) => set({ level }),

  setVoiceError: (voiceError) => set({ voiceError }),

  handle: (action) => {
    const s = get();
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
        set({ speed: Math.min(400, s.speed * SPEED_STEP) });
        break;
      case "slower":
        set({ speed: Math.max(5, s.speed / SPEED_STEP) });
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

/** Lines starting with "## " are sections; blank lines separate paragraphs. */
export function parseScript(body: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let sections = 0;
  const flush = () => {
    if (para.length) blocks.push({ kind: "para", text: para.join(" ") });
    para = [];
  };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      flush();
      blocks.push({ kind: "section", text: line.slice(3).trim(), index: sections++ });
    } else if (line === "") {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}
