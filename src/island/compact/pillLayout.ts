// Pure layout rules for the collapsed pill: a 3-column grid
//   [left slot] [centre: time] [right slot]
// Both side columns are always the same width (the wider side's content), so
// the centre is exactly centred, and each side's items are centred in their
// column. The width comes only from what's visible now, so the pill can never
// get stuck wide. Tested in tests/pillLayout.test.ts.

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
  /** Gap between columns and between items in a column (--ol-pill-slot-gap). */
  gap: 12,
  padding: 14,
  /** Extra room either side when the pill shows only the time. */
  idlePadding: 24,
  minWidth: 96,
};

/** Width of a notification: icon + gap + its short label. */
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
  /** A side notification is showing: its width, or 0 for none. */
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
 * bell appear on the right, like a Dynamic Island.
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

function groupWidth(list: Slot[], slots: PillSlots, gap: number): number {
  if (list.length === 0) return 0;
  return list.reduce((w, s) => w + slotWidth(s, slots), 0) + gap * (list.length - 1);
}

/** Width of each side column: both sides match the wider one. */
export function sideColumn(slots: PillSlots, gap: number = PILL.gap): number {
  return Math.max(groupWidth(slots.left, slots, gap), groupWidth(slots.right, slots, gap));
}

/** Width reserved for the clock, depending on the system's 12/24-hour format. */
export function clockWidth(twelveHour: boolean): number {
  return twelveHour ? PILL.timeWidth12h : PILL.timeWidth;
}

/** Width of a lock-key label ("Caps off") shown in the centre column. */
export function lockWidth(label: string): number {
  return Math.ceil(16 + 6 + label.length * 8.2);
}

/**
 * Pill width = centre column + two equal side columns. `centre` is the
 * time's width, or a wider lock-key label while one is showing.
 */
export function pillWidth(slots: PillSlots, centre: number = PILL.timeWidth, gap: number = PILL.gap): number {
  const side = sideColumn(slots, gap);
  // Time only: give it breathing room so the pill isn't hugging the digits.
  const width = centre + 2 * PILL.padding + (side > 0 ? 2 * (side + gap) : 2 * PILL.idlePadding);
  return Math.max(PILL.minWidth, width);
}

export interface PillGeometry {
  width: number;
  /**
   * Two-part layout: [time] [notification]. Used when a notification arrives
   * while the pill shows only the time, like a Dynamic Island splitting.
   */
  split: boolean;
  /** Horizontal shift of the time from the pill's centre (negative = left). */
  timeShift: number;
  /** Left edge of the notification, measured from the pill's centre. */
  notifyFromCentre: number;
}

/** Full geometry: width plus where the time and notification sit. */
export function pillGeometry(slots: PillSlots, centre: number = PILL.timeWidth, gap: number = PILL.gap): PillGeometry {
  const split = slots.left.length === 0 && slots.right.length === 1 && slots.right[0] === "notify";
  if (!split) {
    return { width: pillWidth(slots, centre, gap), split, timeShift: 0, notifyFromCentre: centre / 2 + gap };
  }
  const width = Math.max(PILL.minWidth, PILL.padding + centre + gap + slots.notifyWidth + PILL.padding);
  return {
    width,
    split,
    timeShift: PILL.padding + centre / 2 - width / 2,
    notifyFromCentre: PILL.padding + centre + gap - width / 2,
  };
}
