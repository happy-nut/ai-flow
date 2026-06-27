// CORE: the git-history (Cmd+9) graph-lane layout. computeHistoryGraph turns commits + parents into
// per-row lanes/edges; these guard the two cases that matter — a linear chain stays in one lane, and a
// merge opens a second lane that collapses back at the shared ancestor.
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

test("history graph: a linear chain stays in one lane and one color", async () => {
  const v = await loadViewer(html);
  const rows = v.window.computeHistoryGraph([
    { hash: "a", parents: ["b"] },
    { hash: "b", parents: ["c"] },
    { hash: "c", parents: [] },
  ]);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.myLane === 0), "every commit sits in lane 0");
  assert.ok(rows.every((r) => r.color === 0), "one color down the chain");
  assert.equal(rows.maxLane, 0, "no extra lanes");
  v.close();
});

test("history graph: a merge opens a 2nd lane that collapses at the shared ancestor", async () => {
  const v = await loadViewer(html);
  const rows = v.window.computeHistoryGraph([
    { hash: "m", parents: ["a", "b"] }, // merge of a and b
    { hash: "a", parents: ["c"] },
    { hash: "b", parents: ["c"] },
    { hash: "c", parents: [] }, // shared ancestor
  ]);
  assert.equal(rows[0].myLane, 0, "merge commit on lane 0");
  assert.equal(rows[0].bottomEdges.length, 2, "merge fans out to two parent lanes");
  assert.ok(rows.maxLane >= 1, "a second lane was opened");
  assert.ok(rows[3].topEdges.length >= 2, "both lanes merge back into the root commit");
  assert.ok(rows[3].bottomEdges.length === 0, "root has no outgoing edge");
  v.close();
});
