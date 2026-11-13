import type { PanelId } from "../stores/island";

// Numeric tokens that JS needs (sizes, springs, delays), read from tokens.css
// so CSS stays the single source of truth.

function readNumber(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

export interface Shape {
  width: number;
  height: number;
  radius: number;
  ear: number;
}

export interface IslandTokens {
  pill: Shape;
  peek: { short: Shape; tall: Shape };
  expanded: { width: number; radius: number; ear: number; heights: Record<PanelId, number> };
  spring: { stiffness: number; damping: number };
  hoverInMs: number;
  hoverOutMs: number;
}

export function readIslandTokens(): IslandTokens {
  const peekRadius = readNumber("--ol-peek-radius", 26);
  const peekEar = readNumber("--ol-peek-ear", 14);
  return {
    pill: {
      width: readNumber("--ol-pill-w", 200),
      height: readNumber("--ol-pill-h", 34),
      radius: readNumber("--ol-pill-radius", 17),
      ear: readNumber("--ol-pill-ear", 12),
    },
    peek: {
      short: {
        width: readNumber("--ol-peek-w-short", 320),
        height: readNumber("--ol-peek-h-short", 52),
        radius: peekRadius - 2,
        ear: peekEar,
      },
      tall: {
        width: readNumber("--ol-peek-w", 360),
        height: readNumber("--ol-peek-h", 60),
        radius: peekRadius,
        ear: peekEar,
      },
    },
    expanded: {
      width: readNumber("--ol-expanded-w", 680),
      heights: {
        home: readNumber("--ol-panel-h-home", 362),
        media: readNumber("--ol-panel-h-media", 262),
        code: readNumber("--ol-panel-h-code", 372),
        prompter: readNumber("--ol-panel-h-prompter", 330),
        focus: readNumber("--ol-panel-h-focus", 300),
        stats: readNumber("--ol-panel-h-stats", 330),
      },
      radius: readNumber("--ol-expanded-radius", 32),
      ear: readNumber("--ol-expanded-ear", 18),
    },
    spring: {
      stiffness: readNumber("--ol-spring-stiffness", 400),
      damping: readNumber("--ol-spring-damping", 30),
    },
    hoverInMs: readNumber("--ol-hover-in-ms", 120),
    hoverOutMs: readNumber("--ol-hover-out-ms", 400),
  };
}
