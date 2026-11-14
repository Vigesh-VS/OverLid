// Pure layout rules for the collapsed pill. The time is always dead centre;
// the pill's width comes only from which slots are visible right now, so it
// can never get stuck wide. Tested in tests/pillLayout.test.ts.

export type Slot = "art" | "bars" | "usage" | "quick" | "focus" | "bell" | "notify";

/** Fixed slot widths (px at 100 % scale). Each slot renders at exactly this width. */
export const SLOT_WIDTH: Record<Exclude<Slot, "notify">, number> = {
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

/** Width of a notification slot: icon + gap + its short label. */
export function notifyWidth(label: string): number {
  // ~6.6 px per character at 12 px semibold, plus an 18 px icon and 6 px gap.
  return Math.ceil(18 + 6 + label.length * 6.6);
}

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
  /** A notification is showing: its slot width, or 0 for none. */
  notify: number;
}

export interface PillSlots {
  left: Slot[];
  right: Slot[];
  /** Width of the "notify" slot, when present. */
  notifyWidth: number;
}

/**
 * Default: just the time. Media playing: art · time · bars. Extended (no
 * media): usage · time · quick action. Notifications and the "needs you"
 * bell always appear on the far right, like a Dynamic Island: the pill
 * widens and the icon pops in there.
 */
export function pillSlots(i: PillInputs): PillSlots {
  let left: Slot[] = [];
  const right: Slot[] = [];
  if (i.mediaPlaying) {
    left = ["art"];
    right.push("bars");
  } else {
    if (i.extended && i.usage) left = ["usage"];
    if (i.focus) right.push("focus");
    if (i.extended && i.quickAction) right.push("quick");
  }
  if (i.attention) right.push("bell");
  if (i.notify > 0) right.push("notify");
  return { left, right, notifyWidth: i.notify };
}

export function slotWidth(slot: Slot, slots: PillSlots): number {
  return slot === "notify" ? slots.notifyWidth : SLOT_WIDTH[slot];
}

function sideWidth(list: Slot[], slots: PillSlots): number {
  if (list.length === 0) return 0;
  return list.reduce((w, s) => w + slotWidth(s, slots), 0) + PILL.gap * (list.length - 1);
}

/** Width reserved for the clock, depending on the system's 12/24-hour format. */
export function clockWidth(twelveHour: boolean): number {
  return twelveHour ? PILL.timeWidth12h : PILL.timeWidth;
}

/** Pill width: the time plus twice the wider side, so the time stays centred. */
export function pillWidth(slots: PillSlots, timeWidth: number = PILL.timeWidth): number {
  const side = Math.max(sideWidth(slots.left, slots), sideWidth(slots.right, slots));
  const width = timeWidth + 2 * PILL.padding + (side > 0 ? 2 * (side + PILL.gap) : 0);
  return Math.max(PILL.minWidth, width);
}
