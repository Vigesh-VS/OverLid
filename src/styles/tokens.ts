// Numeric tokens that JS needs (sizes, springs, delays), read from tokens.css
// so CSS stays the single source of truth.

function readNumber(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

export interface IslandTokens {
  pill: { width: number; height: number; radius: number; ear: number };
  expanded: { width: number; height: number; radius: number; ear: number };
  spring: { stiffness: number; damping: number };
  hoverInMs: number;
  hoverOutMs: number;
}

export function readIslandTokens(): IslandTokens {
  return {
    pill: {
      width: readNumber("--ol-pill-w", 200),
      height: readNumber("--ol-pill-h", 34),
      radius: readNumber("--ol-pill-radius", 17),
      ear: readNumber("--ol-pill-ear", 12),
    },
    expanded: {
      width: readNumber("--ol-expanded-w", 680),
      height: readNumber("--ol-expanded-h", 236),
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
