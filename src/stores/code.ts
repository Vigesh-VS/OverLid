import { create } from "zustand";

import type { ProviderStatus, UsageWindow } from "../lib/ipc";

interface CodeStore {
  usage: ProviderStatus[];
  setUsage: (usage: ProviderStatus[]) => void;
}

export const useCode = create<CodeStore>((set) => ({
  usage: [],
  setUsage: (usage) => set({ usage }),
}));

export type UsageLevel = "ok" | "warn" | "critical";

export function usageLevel(pct: number, warn = 80, critical = 95): UsageLevel {
  if (pct >= critical) return "critical";
  if (pct >= warn) return "warn";
  return "ok";
}

export const LEVEL_COLOR: Record<UsageLevel, string> = {
  ok: "var(--ol-text)",
  warn: "var(--ol-amber)",
  critical: "var(--ol-red)",
};

/** Highest-used window across providers, or null when nothing is known. */
export function hottestWindow(usage: ProviderStatus[]): UsageWindow | null {
  let best: UsageWindow | null = null;
  for (const p of usage) {
    for (const w of p.snapshot?.windows ?? []) {
      if (!best || w.usedPercent > best.usedPercent) best = w;
    }
  }
  return best;
}

/** "in 2h 14m" within a day, otherwise "Tue 09:00". */
export function resetLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return "reset unknown";
  const at = new Date(iso);
  const secs = Math.max(0, Math.round((at.getTime() - now) / 1000));
  if (secs < 86_400) {
    const h = Math.floor(secs / 3600);
    const m = Math.max(1, Math.floor((secs % 3600) / 60));
    return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
  }
  const day = at.toLocaleDateString(undefined, { weekday: "short" });
  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day} ${time}`;
}

/** "just now", "3 min ago", "2 h ago". */
export function ageLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}
