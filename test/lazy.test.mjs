// CORE USER FLOW: lazy-LOAD source view (big repos / serve / Electron).
//
// In lazy-LOAD the standalone HTML ships source metadata only (no content); the body is fetched on demand
// via window.monacoriFile.getSourceData(). This guards the critical regression where one file's content
// rendered under another file's path because the caret fast-path trusted metadata over the painted body —
// fixed by tracking sourceBodyPath (the path actually painted) and re-rendering on mismatch.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { makeReviewHtml, cleanupFixtures } from "./helpers/fixture.mjs";
import { loadViewer } from "./helpers/dom.mjs";

let html, lazySourceData;
before(async () => {
  const r = await makeReviewHtml(
    [
      { path: "src/one.ts", before: "export const one = 1;\n", after: "export const one = 11;\n" },
      { path: "src/two.ts", before: "export const two = 2;\n", after: "export const two = 22;\n" },
    ],
    { lazyLoad: true },
  );
  html = r.html;
  lazySourceData = r.build.lazySourceData;
});
after(cleanupFixtures);

test("lazy-LOAD: source view renders each file's OWN content after async fetch", async () => {
  const v = await loadViewer(html, { lazySourceData });
  await v.openSourceFile("src/two.ts");
  await v.settle(150); // loadSourceData resolves async, then re-opens the file with content
  assert.match(v.$("#source-title").textContent, /two\.ts/, "breadcrumb is src/two.ts");
  assert.match(v.$("#source-body").textContent, /export const two = 22/, "body shows src/two.ts content");
  assert.doesNotMatch(v.$("#source-body").textContent, /one = 11/, "body does NOT show another file's content");
  v.close();
});

test("lazy-LOAD: switching files shows the new file's content, never a stale body (path↔content fix)", async () => {
  const v = await loadViewer(html, { lazySourceData });
  await v.openSourceFile("src/one.ts");
  await v.settle(150);
  assert.match(v.$("#source-body").textContent, /one = 11/, "src/one.ts content shown");
  await v.openSourceFile("src/two.ts");
  await v.settle(150);
  const body = v.$("#source-body").textContent;
  assert.match(body, /two = 22/, "switched to src/two.ts content");
  assert.doesNotMatch(body, /one = 11/, "stale src/one.ts body is gone (sourceBodyPath guard)");
  v.close();
});

// REGRESSION: a watch refresh (in-place diff update) cleared bodyPromise but NOT bodyCache, which is keyed
// by file INDEX. loadBodyHtml then returned the cached OLD body for the same index, so a working-tree change
// never appeared in the diff until a full reload. applyDiffUpdate must drop bodyCache too.
test("lazy-LOAD: a watch refresh shows the rebuilt diff body, not the cached old one", async () => {
  const b1 = await makeReviewHtml(
    [{ path: "src/live.ts", before: "export const x = 1;\n", after: "export const x = 111;\n" }],
    { lazyLoad: true },
  );
  let bodies = b1.build.lazyBodies || [];
  const v = await loadViewer(b1.html, {
    menuBridge: true,
    lazySourceData: b1.build.lazySourceData,
    getDiffBody: (idx) => bodies[idx] || "",
  });
  await v.openDiffFor("src/live.ts");
  await v.settle(120);
  assert.match(v.$("#diff2html-container").textContent, /111/, "initial diff body shown");

  // A watch rebuild changes the SAME file again -> a new body for the same index.
  const b2 = await makeReviewHtml(
    [{ path: "src/live.ts", before: "export const x = 1;\n", after: "export const x = 222;\n" }],
    { lazyLoad: true },
  );
  bodies = b2.build.lazyBodies || []; // the bridge now serves the rebuilt body for that index
  await v.pushDiffUpdate(b2.build.update);
  await v.settle(120);

  const text = v.$("#diff2html-container").textContent;
  assert.match(text, /222/, "rebuilt body shown after the watch refresh");
  assert.doesNotMatch(text, /111/, "stale cached body is gone");
  v.close();
});
