import { create } from "zustand";

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

interface IslandState {
  mode: IslandMode;
  hovered: boolean;
  panel: PanelId;
  setMode: (mode: IslandMode) => void;
  setHovered: (hovered: boolean) => void;
  setPanel: (panel: PanelId) => void;
}

export const useIsland = create<IslandState>((set) => ({
  mode: "collapsed",
  hovered: false,
  panel: "home",
  setMode: (mode) => set({ mode }),
  setHovered: (hovered) => set({ hovered }),
  setPanel: (panel) => set({ panel }),
}));
