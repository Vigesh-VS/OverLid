import { useEffect, useState, type CSSProperties } from "react";
import { create } from "zustand";

import { accentFromImage } from "../lib/color";
import { commands, type AmbientSettings, type AmbientSpeed } from "../lib/ipc";
import { useMedia } from "../stores/media";
import styles from "./AmbientLayer.module.css";

/** Latest live-screen colour, fed by the bridge while presenting. */
export const useAmbientColor = create<{ screen: string | null; set: (c: string) => void }>((set) => ({
  screen: null,
  set: (screen) => set({ screen }),
}));

const DURATION: Record<AmbientSpeed, string> = { static: "0s", slow: "28s", medium: "14s" };

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Darkened version of a colour so the glow stays a background tint. */
function darken(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const k = 0.55;
  return `rgb(${Math.round(r * k)} ${Math.round(g * k)} ${Math.round(b * k)})`;
}

/**
 * Opacity that keeps text contrast at 7:1 or better. Over pure black, a
 * colour at opacity α has luminance at most α·L, so cap α accordingly.
 */
export function safeOpacity(intensity: number, colors: string[], textColor: string): number {
  const lt = luminance(hexToRgb(textColor));
  const maxBg = Math.max(0, (lt + 0.05) / 7 - 0.05);
  const brightest = Math.max(...colors.map((c) => luminance(hexToRgb(c)) * 0.55 ** 2.2), 1e-4);
  return Math.max(0, Math.min(intensity, maxBg / brightest));
}

/** Resolve the colour(s) for the chosen source. */
export function useAmbientColors(settings: AmbientSettings | undefined, active: boolean): string[] {
  const screen = useAmbientColor((s) => s.screen);
  const accent = useMedia((s) => s.accent);
  const hasArt = useMedia((s) => !!s.media?.art);
  const [wallpaper, setWallpaper] = useState<string | null>(null);

  useEffect(() => {
    if (!active || settings?.source !== "wallpaper") return;
    let cancelled = false;
    commands
      .ambientWallpaper()
      .then(async (w) => {
        if (!w) return null;
        return w.startsWith("data:") ? accentFromImage(w) : w;
      })
      .then((c) => !cancelled && c && setWallpaper(c), () => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, settings?.source]);

  if (!settings) return [];
  switch (settings.source) {
    case "screen":
      return [screen ?? "#2b3a55"];
    case "wallpaper":
      return [wallpaper ?? "#2b3a55"];
    case "album":
      return [hasArt ? accent : "#2b3a55"];
    case "custom":
      return settings.colors.length ? settings.colors : ["#4F8CFF"];
  }
}

/**
 * A very subtle, slow, blurred glow behind the prompter text. It's its own
 * layer under the text and never affects it. GPU-friendly CSS only.
 */
export function AmbientLayer({
  settings,
  colors,
  textColor,
}: {
  settings: AmbientSettings;
  colors: string[];
  textColor: string;
}) {
  if (!settings.enabled || colors.length === 0) return null;
  const opacity = safeOpacity(settings.intensity, colors, textColor);
  const blobs = [colors[0], colors[1] ?? colors[0], colors[2] ?? colors[1] ?? colors[0]];
  return (
    <div
      className={styles.layer}
      aria-hidden="true"
      style={
        {
          "--blur": `${settings.blur}px`,
          "--duration": DURATION[settings.speed],
          opacity,
        } as CSSProperties
      }
    >
      {blobs.map((c, i) => (
        <span key={i} className={styles[`blob${i}`]} style={{ background: darken(c) }} />
      ))}
    </div>
  );
}
