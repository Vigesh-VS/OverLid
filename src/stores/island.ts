import { create } from "zustand";

import type { IslandFlags, Peek } from "../lib/ipc";

export type IslandMode = "collapsed" | "expanded";
export type PanelId = "home" | "media" | "code" | "prompter" | "focus" | "stats";

export const PANELS: ReadonlyArray<{ id: PanelId; label: string }> = [
  { id: "home", label: "Home" },
  { id: "media", label: "Media" },
  { id: "code", label: "Code" },
  { id: "prompter", label: "Prompter" },
  { id: "focus", label: "Focus" },
  { id: "stats", label: "Stats" },
];

const MAX_QUEUED_PEEKS = 6;

interface IslandState {
  mode: IslandMode;
  hovered: boolean;
  panel: PanelId;
  flags: IslandFlags;
  /** Peek on screen right now, if any. */
  peek: Peek | null;
  queue: Peek[];
  /** A resize drag is in progress; the hit rect covers the whole window. */
  dragging: boolean;
  setDragging: (dragging: boolean) => void;
  /** Measured content height of each expanded panel. */
  panelHeights: Partial<Record<PanelId, number>>;
  setPanelHeight: (panel: PanelId, height: number) => void;
  /** Pointer is over a clickable pill indicator: wait longer before expanding. */
  overIndicator: boolean;
  setOverIndicator: (over: boolean) => void;
  /** An indicator was clicked; don't expand until the cursor leaves. */
  suppressExpand: boolean;
  setSuppressExpand: (suppress: boolean) => void;
  setMode: (mode: IslandMode) => void;
  setHovered: (hovered: boolean) => void;
  setPanel: (panel: PanelId) => void;
  setFlags: (flags: IslandFlags) => void;
  pushPeek: (peek: Peek) => void;
  /** Drop the current peek and show the next queued one. */
  nextPeek: () => void;
  clearPeeks: () => void;
}

export const useIsland = create<IslandState>((set) => ({
  mode: "collapsed",
  hovered: false,
  panel: "home",
  flags: { paused: false, gameMode: false, fullscreen: false, prompter: false },
  peek: null,
  queue: [],
  dragging: false,
  setDragging: (dragging) => set({ dragging }),
  panelHeights: {},
  setPanelHeight: (panel, height) =>
    set((s) => (s.panelHeights[panel] === height ? s : { panelHeights: { ...s.panelHeights, [panel]: height } })),
  overIndicator: false,
  setOverIndicator: (overIndicator) => set({ overIndicator }),
  suppressExpand: false,
  setSuppressExpand: (suppressExpand) => set({ suppressExpand }),
  setMode: (mode) => set({ mode }),
  setHovered: (hovered) => set(hovered ? { hovered } : { hovered, suppressExpand: false, overIndicator: false }),
  setPanel: (panel) => set({ panel }),
  setFlags: (flags) => set({ flags }),
  pushPeek: (peek) =>
    set((s) => {
      // Replace a queued peek of the same kind instead of stacking duplicates.
      if (s.peek?.kind === peek.kind) return { peek };
      const queue = [...s.queue.filter((p) => p.kind !== peek.kind), peek].slice(-MAX_QUEUED_PEEKS);
      return s.peek ? { queue } : { peek: queue[0], queue: queue.slice(1) };
    }),
  nextPeek: () => set((s) => ({ peek: s.queue[0] ?? null, queue: s.queue.slice(1) })),
  clearPeeks: () => set({ peek: null, queue: [] }),
}));
