import { useEffect, useState } from "react";
import { create } from "zustand";

import { accentFromImage } from "../lib/color";
import type { MediaState } from "../lib/ipc";

const DEFAULT_ACCENT = "#d0d0d4";

interface MediaStore {
  media: MediaState | null;
  accent: string;
  setMedia: (media: MediaState | null) => void;
}

let accentFor: string | null = null;

export const useMedia = create<MediaStore>((set) => ({
  media: null,
  accent: DEFAULT_ACCENT,
  setMedia: (media) => {
    set({ media });
    const art = media?.art ?? null;
    if (art === accentFor) return;
    accentFor = art;
    if (!art) {
      set({ accent: DEFAULT_ACCENT });
      return;
    }
    accentFromImage(art)
      .then((accent) => {
        if (accentFor === art) set({ accent });
      })
      .catch(() => {
        if (accentFor === art) set({ accent: DEFAULT_ACCENT });
      });
  },
}));

/** Playback position interpolated locally between timeline events. */
export function useMediaPosition(media: MediaState | null, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  const playing = media?.playing ?? false;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [playing, intervalMs]);

  if (!media) return 0;
  let position = media.positionMs;
  if (media.playing && media.timelineAtMs > 0) {
    position += Math.max(0, now - media.timelineAtMs);
  }
  return media.durationMs > 0 ? Math.min(position, media.durationMs) : position;
}
