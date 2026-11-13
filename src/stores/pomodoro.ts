import { useEffect, useState } from "react";
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

/** Remaining time for a snapshot at `now`: counts down from Rust's end time. */
export function remainingAt(state: PomoState, now: number): number {
  if (state.running && state.endsAtMs !== null) return Math.max(0, state.endsAtMs - now);
  return state.remainingMs;
}

/**
 * The one way every view reads the timer: Rust's snapshot plus a shared
 * clock, so the pill, Focus panel and Home always show the same time.
 */
export function usePomoView(): { state: PomoState | null; remainingMs: number; progress: number } {
  const state = usePomodoro((s) => s.state);
  const [now, setNow] = useState(() => Date.now());
  const running = state?.running ?? false;

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running, state]);

  if (!state) return { state: null, remainingMs: 0, progress: 0 };
  const remainingMs = remainingAt(state, now);
  const progress = state.totalMs > 0 ? 1 - remainingMs / state.totalMs : 0;
  return { state, remainingMs, progress };
}

/** A timer is "active" while it runs or is paused part-way through. */
export function pomoActive(state: PomoState | null): boolean {
  return !!state && (state.running || state.remainingMs < state.totalMs);
}
