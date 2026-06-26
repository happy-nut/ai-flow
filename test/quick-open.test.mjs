// CORE USER FLOW: double-Shift opens the quick-open (file search). The sequence must require TWO Shifts in
// a row — any keystroke between them cancels it. Guards the regression where "Shift → type → Shift" within
// 300ms still popped the search, so it fired on nearly every other keystroke (maddening while typing).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { makeReviewHtml, cleanupFixtures } from "./helpers/fixture.mjs";
import { loadViewer } from "./helpers/dom.mjs";

let html;
before(async () => {
  ({ html } = await makeReviewHtml([
    { path: "src/a.ts", before: "export const a = 1;\n", after: "export const a = 2;\n" },
  ]));
});
after(cleanupFixtures);

test("double-Shift (same side, in quick succession) opens quick-open", async () => {
  const v = await loadViewer(html);
  v.key("Shift", { location: 1 });
  v.key("Shift", { location: 1 });
  await v.settle(10);
  assert.ok(v.quickOpenVisible(), "Shift Shift opened quick-open");
  v.close();
});

test("a plain keystroke between the two Shifts cancels quick-open", async () => {
  const v = await loadViewer(html);
  v.key("Shift", { location: 1 });
  v.key("k"); // a stray keystroke between the Shifts
  v.key("Shift", { location: 1 });
  await v.settle(10);
  assert.equal(v.quickOpenVisible(), false, "the in-between key cancelled the double-Shift sequence");
  v.close();
});

test("an arrow key between the two Shifts also cancels it", async () => {
  const v = await loadViewer(html);
  v.key("Shift", { location: 1 });
  v.key("ArrowDown"); // arrows are swallowed by the caret handlers — the reset must run before them
  v.key("Shift", { location: 1 });
  await v.settle(10);
  assert.equal(v.quickOpenVisible(), false, "arrow between Shifts cancelled the sequence");
  v.close();
});

test("two Shifts on DIFFERENT sides do not open quick-open", async () => {
  const v = await loadViewer(html);
  v.key("Shift", { location: 1 }); // left
  v.key("Shift", { location: 2 }); // right
  await v.settle(10);
  assert.equal(v.quickOpenVisible(), false, "left+right Shift must not trigger");
  v.close();
});
