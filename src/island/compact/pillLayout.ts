// Pure layout rules for the collapsed pill. The time is always dead centre;
// the pill's width comes only from which slots are visible right now, so it
// can never get stuck wide. Tested in tests/pillLayout.test.ts.

export type Slot = "art" | "bars" | "usage" | "quick" | "focus" | "bell";

/** Fixed slot widths (px at 100 % scale). Each slot renders at exactly this width. */
export const SLOT_WIDTH: Record<Slot, number> = {
  art: 20,
  bars: 16,
  usage: 52,
  quick: 22,
  focus: 58,
  bell: 22,
};

export const PILL = {
  /** Room for "00:00" in 16 px semibold tabular figures (24-hour clock). */
  timeWidth: 46,
  /** Room for "00:00 am" (12-hour clock). */
  timeWidth12h: 72,
  /** Space between the time and the slots, and between slots. */
  gap: 10,
  padding: 14,
  minWidth: 96,
};

export interface PillInputs {
  mediaPlaying: boolean;
  /** A Claude Code session needs you (persistent bell). */
  attention: boolean;
  /** Settings › Display › Extended pill. */
  extended: boolean;
  /** Extended mode has a usage reading to show. */
  usage: boolean;
  /** Extended mode has a quick action configured. */
  quickAction: boolean;
  /** "Show focus countdown in pill" is on and a timer is active. */
  focus: boolean;
}

export interface PillSlots {
  left: Slot[];
  right: Slot[];
}

/**
 * Default: just the time. Media playing: art · time · bars, nothing else.
 * Extended (and no media): usage · time · quick action. The attention bell
 * always takes the left slot, because it must be impossible to miss.
 */
export function pillSlots(i: PillInputs): PillSlots {
  let left: Slot[] = [];
  let right: Slot[] = [];
  if (i.mediaPlaying) {
    left = ["art"];
    right = ["bars"];
  } else {
    if (i.extended && i.usage) left = ["usage"];
    if (i.focus) right.push("focus");
    if (i.extended && i.quickAction) right.push("quick");
  }
  if (i.attention) left = ["bell"];
  return { left, right };
}

function sideWidth(slots: Slot[]): number {
  if (slots.length === 0) return 0;
  return slots.reduce((w, s) => w + SLOT_WIDTH[s], 0) + PILL.gap * (slots.length - 1);
}

/** Width reserved for the clock, depending on the system's 12/24-hour format. */
export function clockWidth(twelveHour: boolean): number {
  return twelveHour ? PILL.timeWidth12h : PILL.timeWidth;
}

/** Pill width: the time plus twice the wider side, so the time stays centred. */
export function pillWidth(slots: PillSlots, timeWidth: number = PILL.timeWidth): number {
  const side = Math.max(sideWidth(slots.left), sideWidth(slots.right));
  const width = timeWidth + 2 * PILL.padding + (side > 0 ? 2 * (side + PILL.gap) : 0);
  return Math.max(PILL.minWidth, width);
}
