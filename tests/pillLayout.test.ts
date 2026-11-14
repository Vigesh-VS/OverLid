// Run with `npm test` (Node's built-in runner, no extra dependencies).
import assert from "node:assert/strict";
import { test } from "node:test";

import { PILL, lockWidth, notifyWidth, pillSlots, pillWidth, sideColumn, type PillInputs } from "../src/island/compact/pillLayout.ts";

const idle: PillInputs = {
  mediaPlaying: false,
  attention: false,
  extended: false,
  usage: true,
  quickAction: true,
  focus: false,
  notify: 0,
};

test("default pill shows only the time", () => {
  const slots = pillSlots(idle);
  assert.deepEqual(slots, { left: [], right: [], notifyWidth: 0 });
  assert.equal(pillWidth(slots), Math.max(PILL.minWidth, PILL.timeWidth + 2 * PILL.padding));
});

test("media playing: art left, bars right, nothing else", () => {
  const slots = pillSlots({ ...idle, mediaPlaying: true, extended: true, focus: true });
  assert.deepEqual(slots, { left: ["art"], right: ["bars"], notifyWidth: 0 });
});

test("extended mode: usage left, quick action right", () => {
  assert.deepEqual(pillSlots({ ...idle, extended: true }), { left: ["usage"], right: ["quick"], notifyWidth: 0 });
});

test("slot appears, then disappears: width returns to the original", () => {
  const before = pillWidth(pillSlots(idle));
  const withFocus = pillWidth(pillSlots({ ...idle, focus: true }));
  assert.ok(withFocus > before, "pill grows when the focus slot appears");
  const after = pillWidth(pillSlots({ ...idle, focus: false }));
  assert.equal(after, before, "and shrinks back exactly when it goes");
});

test("growth is symmetric so the time stays centred", () => {
  const slots = pillSlots({ ...idle, mediaPlaying: true });
  const w = pillWidth(slots);
  // (w - time) / 2 is the room on each side; both sides must fit their slots.
  const room = (w - PILL.timeWidth) / 2;
  assert.ok(room >= 20 + PILL.gap && room >= 16 + PILL.gap);
});

test("the attention bell shows on the right, even over media", () => {
  const slots = pillSlots({ ...idle, mediaPlaying: true, attention: true });
  assert.deepEqual(slots.left, ["art"]);
  assert.deepEqual(slots.right, ["bars", "bell"]);
});

test("a notification widens the pill and sits on the far right, then the pill shrinks back", () => {
  const before = pillWidth(pillSlots(idle));
  const w = notifyWidth("Caps on");
  const withNote = pillSlots({ ...idle, notify: w });
  assert.deepEqual(withNote.right, ["notify"]);
  assert.ok(pillWidth(withNote) >= PILL.timeWidth + 2 * (w + PILL.gap), "room for the icon on both sides, time centred");
  assert.equal(pillWidth(pillSlots({ ...idle, notify: 0 })), before);
});

test("a 12-hour clock gets room for am/pm", () => {
  const slots = pillSlots(idle);
  assert.ok(pillWidth(slots, PILL.timeWidth12h) > pillWidth(slots, PILL.timeWidth));
  assert.ok(pillWidth(slots, PILL.timeWidth12h) >= PILL.timeWidth12h + 2 * PILL.padding);
});

test("3-column grid: both side columns equal the wider side", () => {
  const slots = pillSlots({ ...idle, extended: true });
  // usage (52) on the left, quick action (22) on the right: both columns are 52 wide.
  assert.equal(sideColumn(slots), 52);
  assert.equal(pillWidth(slots), PILL.timeWidth + 2 * PILL.padding + 2 * (52 + PILL.gap));
});

test("media pill keeps the slot gap on both sides of the time", () => {
  const slots = pillSlots({ ...idle, mediaPlaying: true });
  const w = pillWidth(slots);
  const room = (w - PILL.timeWidth - 2 * PILL.padding) / 2;
  assert.equal(room, sideColumn(slots) + PILL.gap);
  assert.ok(PILL.gap >= 10 && PILL.gap <= 12);
});

test("a lock-key label only grows the pill when it's wider than the time", () => {
  const slots = pillSlots(idle);
  const narrow = 30;
  assert.equal(pillWidth(slots, Math.max(PILL.timeWidth12h, narrow)), pillWidth(slots, PILL.timeWidth12h));
  const wide = lockWidth("Caps off");
  assert.ok(pillWidth(slots, Math.max(PILL.timeWidth, wide)) > pillWidth(slots, PILL.timeWidth));
});
