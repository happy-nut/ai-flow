import { test } from "node:test";
import assert from "node:assert/strict";
import { relaunchArgsForCwd, relaunchUpdatedApp } from "../dist/self-update.js";

test("self-update relaunch args preserve the app entry and replace --cwd with the active repo", () => {
  const args = relaunchArgsForCwd([
    "/path/to/electron",
    "/global/monacori/dist/app-main.js",
    "--cwd",
    "/old/repo",
    "--context",
    "100000",
    "--include-untracked",
  ], "/active/repo");

  assert.deepEqual(args, [
    "/global/monacori/dist/app-main.js",
    "--cwd",
    "/active/repo",
    "--context",
    "100000",
    "--include-untracked",
  ]);
});

test("self-update relaunch args append --cwd when the current argv has none", () => {
  assert.deepEqual(
    relaunchArgsForCwd(["/path/to/electron", "/global/monacori/dist/app-main.js"], "/active/repo"),
    ["/global/monacori/dist/app-main.js", "--cwd", "/active/repo"],
  );
});

test("self-update relaunch args repair a dangling --cwd", () => {
  assert.deepEqual(
    relaunchArgsForCwd(["/path/to/electron", "/global/monacori/dist/app-main.js", "--cwd"], "/active/repo"),
    ["/global/monacori/dist/app-main.js", "--cwd", "/active/repo"],
  );
});

test("self-update relaunch uses Electron relaunch before exiting", () => {
  const calls = [];
  const app = {
    relaunch(options) { calls.push(["relaunch", options]); },
    exit(code) { calls.push(["exit", code]); },
  };

  relaunchUpdatedApp(app, ["/path/to/electron", "/global/monacori/dist/app-main.js", "--cwd", "/old"], "/active");

  assert.deepEqual(calls, [
    ["relaunch", { args: ["/global/monacori/dist/app-main.js", "--cwd", "/active"] }],
    ["exit", 0],
  ]);
});
