// Run with `npm test` (Node's built-in runner, no extra dependencies).
import assert from "node:assert/strict";
import { test } from "node:test";

import { PILL, pillSlots, pillWidth, type PillInputs } from "../src/island/compact/pillLayout.ts";

const idle: PillInputs = {
  mediaPlaying: false,
  attention: false,
  extended: false,
  usage: true,
  quickAction: true,
  focus: false,
};

test("default pill shows only the time", () => {
  const slots = pillSlots(idle);
  assert.deepEqual(slots, { left: [], right: [] });
  assert.equal(pillWidth(slots), Math.max(PILL.minWidth, PILL.timeWidth + 2 * PILL.padding));
});

test("media playing: art left, bars right, nothing else", () => {
  const slots = pillSlots({ ...idle, mediaPlaying: true, extended: true, focus: true });
  assert.deepEqual(slots, { left: ["art"], right: ["bars"] });
});

test("extended mode: usage left, quick action right", () => {
  assert.deepEqual(pillSlots({ ...idle, extended: true }), { left: ["usage"], right: ["quick"] });
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

test("the attention bell always shows, even over media", () => {
  assert.deepEqual(pillSlots({ ...idle, mediaPlaying: true, attention: true }).left, ["bell"]);
});

test("a 12-hour clock gets room for am/pm", () => {
  const slots = pillSlots(idle);
  assert.ok(pillWidth(slots, PILL.timeWidth12h) > pillWidth(slots, PILL.timeWidth));
  assert.ok(pillWidth(slots, PILL.timeWidth12h) >= PILL.timeWidth12h + 2 * PILL.padding);
});
