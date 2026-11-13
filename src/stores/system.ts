import { create } from "zustand";

import type { LockKeys, Settings, SystemTick } from "../lib/ipc";

interface SystemStore {
  tick: SystemTick | null;
  keys: LockKeys | null;
  settings: Settings | null;
  setTick: (tick: SystemTick) => void;
  setKeys: (keys: LockKeys) => void;
  setSettings: (settings: Settings) => void;
}

export const useSystem = create<SystemStore>((set) => ({
  tick: null,
  keys: null,
  settings: null,
  setTick: (tick) => set({ tick }),
  setKeys: (keys) => set({ keys }),
  setSettings: (settings) => set({ settings }),
}));
