import { create } from "zustand";

import type { PomoPhase, PomoState } from "../lib/ipc";

export const PHASE_LABEL: Record<PomoPhase, string> = {
  focus: "Focus",
  shortBreak: "Short break",
  longBreak: "Long break",
};

interface PomodoroStore {
  state: PomoState | null;
  setState: (state: PomoState) => void;
}

export const usePomodoro = create<PomodoroStore>((set) => ({
  state: null,
  setState: (state) => set({ state }),
}));

/** True when the timer should claim the collapsed pill. */
export function pomoActive(state: PomoState | null): boolean {
  return !!state && (state.running || state.remainingMs < state.totalMs);
}
