import { useEffect } from "react";
import { create } from "zustand";

import { commands, inTauri, on, type Settings } from "../lib/ipc";

interface SettingsStore {
  settings: Settings | null;
  error: string | null;
  set: (settings: Settings) => void;
  /** Apply a change and persist it; Rust sanitises and echoes the result. */
  update: (change: (s: Settings) => Settings) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,
  error: null,
  set: (settings) => set({ settings }),
  update: (change) => {
    const current = get().settings;
    if (!current) return;
    const next = change(current);
    set({ settings: next });
    commands
      .settingsSet(next)
      .then((saved) => set({ settings: saved, error: null }))
      .catch((e: unknown) => set({ error: `Couldn't save: ${String(e)}` }));
  },
}));

let subscribed = false;

/** Load settings once and follow changes made elsewhere (tray, island). */
export function useSettings() {
  const store = useSettingsStore();
  useEffect(() => {
    if (subscribed || !inTauri) return;
    subscribed = true;
    commands.settingsGet().then(useSettingsStore.getState().set, () => undefined);
    void on("settings://changed", (s) => useSettingsStore.getState().set(s));
  }, []);
  return store;
}

/** Shallow helper for updating one section. */
export function section<K extends Exclude<keyof Settings, "version">>(key: K, patch: Partial<Settings[K]>) {
  return (s: Settings): Settings => ({ ...s, [key]: { ...s[key], ...patch } });
}
