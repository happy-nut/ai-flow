import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { DiffReviewResult, FlowConfig, VerificationRun } from "./types.js";
import { AGENT_SNIPPET_FILE, CONFIG_FILE, DECISIONS_FILE, FLOW_DIR, GITIGNORE_FILE, STATE_FILE } from "./constants.js";
import { codeBlock, listRecentFiles, parsePositiveInteger, readOption, readStdin, sanitizeFilePart, summarizeForState, timestampForFile } from "./util.js";
import { git, readGitSnapshot } from "./git.js";
import { createDiffReview, serveDiffWatch } from "./server.js";

const nodeRequire = createRequire(import.meta.url);

export function main(): void {
  const rawArgs = process.argv.slice(2);
  const [command, ...args] = rawArgs;

  try {
    if (!command) {
      openCurrentRepository([]);
      return;
    }
    if (command !== "--help" && command !== "-h" && command.startsWith("-")) {
      openCurrentRepository(rawArgs);
      return;
    }

    switch (command) {
      case "init":
        initFlow(args);
        break;
      case "install":
        installFlow(args);
        break;
      case "check":
      case "go":
        runCheck(args);
        break;
      case "verify":
        runVerification(args);
        break;
      case "diff":
        renderDiffReview(args);
        break;
      case "app":
      case "review":
        launchReviewApp(args);
        break;
      case "open":
        openCurrentRepository(args);
        break;
      case "status":
        printStatus();
        break;
      case "report":
        recordReport(args);
        break;
      case "--help":
      case "-h":
      case "help":
        printHelp();
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`monacori: ${message}`);
    process.exit(1);
  }
}

function initFlow(args: string[]): void {
  const force = args.includes("--force");
  const quiet = args.includes("--quiet");
  const root = process.cwd();
  const flowPath = join(root, FLOW_DIR);
  mkdirSync(flowPath, { recursive: true });
  mkdirSync(join(flowPath, "reports"), { recursive: true });
  mkdirSync(join(flowPath, "logs"), { recursive: true });
  mkdirSync(join(flowPath, "diffs"), { recursive: true });

  const config: FlowConfig = {
    version: 1,
    projectName: basename(root),
    verification: {
      commands: detectVerificationCommands(root),
    },
    diff: {
      context: 12,
      includeUntracked: false,
    },
  };

  writeIfMissing(join(flowPath, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`, force);
  writeIfMissing(join(flowPath, STATE_FILE), initialState(config), force);
  writeIfMissing(join(flowPath, DECISIONS_FILE), initialDecisions(), force);
  const ignored = ensureMonacoriGitignore(root);

  if (!quiet) {
    console.log(`Initialized ${FLOW_DIR}/ in ${root}`);
    if (ignored) {
      console.log(`Updated ${GITIGNORE_FILE} to ignore ${FLOW_DIR}/ validation artifacts.`);
    }
    console.log("Next: run `monacori app --include-untracked` to inspect changes, then `monacori check --include-untracked` to record verification.");
  }
}

function installFlow(args: string[]): void {
  const force = args.includes("--force");
  const applyAgentDocs = args.includes("--apply-agent-docs");
  initFlow(["--quiet"]);
  writeIfMissing(join(process.cwd(), FLOW_DIR, AGENT_SNIPPET_FILE), agentSnippet(), force);
  if (applyAgentDocs) {
    applyAgentDocSnippet("AGENTS.md");
    applyAgentDocSnippet("CLAUDE.md");
  }

  console.log("Installed monacori validation instructions.");
  console.log(`- ${FLOW_DIR}/${AGENT_SNIPPET_FILE}`);
  if (applyAgentDocs) {
    console.log("- Updated AGENTS.md / CLAUDE.md validation snippets where available.");
  } else {
    console.log(`Next: add ${FLOW_DIR}/${AGENT_SNIPPET_FILE} to your agent instructions if desired.`);
  }
}

function runCheck(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    printCheckHelp();
    return;
  }
  ensureWritableFlowState();

  const config = loadConfig();
  const separator = args.indexOf("--");
  const commandArgs = separator >= 0 ? args.slice(separator + 1) : [];
  const optionArgs = separator >= 0 ? args.slice(0, separator) : args;
  const noVerify = optionArgs.includes("--no-verify");
  const noDiff = optionArgs.includes("--no-diff");
  const openInBrowser = optionArgs.includes("--open");
  const includeUntracked = optionArgs.includes("--include-untracked") || config.diff.includeUntracked;
  const staged = optionArgs.includes("--staged");
  const base = readOption(optionArgs, "--base");
  const contextValue = readOption(optionArgs, "--context");
  const context = contextValue ? parsePositiveInteger(contextValue, "--context") : config.diff.context;

  const verification = noVerify
    ? { commands: [], failed: false, skipped: true } satisfies VerificationRun
    : executeVerification(commandArgs.join(" "));

  let review: DiffReviewResult | undefined;
  if (!noDiff) {
    review = createDiffReview({
      base,
      staged,
      includeUntracked,
      context,
      output: join(process.cwd(), FLOW_DIR, "diffs", `${timestampForFile()}-check.html`),
      title: "monacori validation diff",
    });
    if (openInBrowser) {
      spawnSync("open", [review.path], { stdio: "ignore" });
    }
  }

  const reportPath = writeCheckReport({ verification, review });
  console.log("# monacori check");
  console.log(`Verification: ${verification.skipped ? "skipped" : verification.failed ? "failed" : "passed"}`);
  if (verification.logPath) {
    console.log(`Log: ${relative(process.cwd(), verification.logPath)}`);
  }
  if (review) {
    console.log(`Diff review: ${relative(process.cwd(), review.path)}`);
    console.log(`Files: ${review.files}`);
    console.log(`Hunks: ${review.hunks}`);
  }
  console.log(`Report: ${relative(process.cwd(), reportPath)}`);
  if (verification.failed) {
    process.exit(1);
  }
}

function runVerification(args: string[]): void {
  const separator = args.indexOf("--");
  const explicitCommand = separator >= 0 ? args.slice(separator + 1).join(" ") : "";
  const result = executeVerification(explicitCommand, { requireCommands: true });
  if (result.logPath) {
    console.log(`Verification log: ${relative(process.cwd(), result.logPath)}`);
  }
  if (result.failed) {
    console.error("Verification failed.");
    process.exit(1);
  }
  console.log("Verification passed.");
}

function renderDiffReview(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    printDiffHelp();
    return;
  }
  ensureWritableFlowState();

  const config = loadConfig();
  const contextValue = readOption(args, "--context");
  const context = contextValue ? parsePositiveInteger(contextValue, "--context") : config.diff.context;
  const base = readOption(args, "--base");
  const staged = args.includes("--staged");
  const includeUntracked = args.includes("--include-untracked") || config.diff.includeUntracked;
  const openInBrowser = args.includes("--open");
  const watch = args.includes("--watch");
  const ignoreWhitespace = args.includes("--ignore-whitespace");

  if (watch) {
    serveDiffWatch({
      base,
      staged,
      includeUntracked,
      context,
      openInBrowser,
      port: readOption(args, "--port"),
      ignoreWhitespace,
    });
    return;
  }

  const output = readOption(args, "--output") ??
    join(process.cwd(), FLOW_DIR, "diffs", `${timestampForFile()}-review.html`);
  const result = createDiffReview({
    base,
    staged,
    includeUntracked,
    context,
    output,
    title: "monacori diff review",
    ignoreWhitespace,
  });

  if (openInBrowser) {
    spawnSync("open", [result.path], { stdio: "ignore" });
  }

  console.log(`Diff review: ${relative(process.cwd(), result.path)}`);
  console.log(`URL: ${result.url}`);
  console.log(`Files: ${result.files}`);
  console.log(`Hunks: ${result.hunks}`);
  console.log("Keys: F7 next hunk, Shift+F7 previous hunk, Shift Shift search files, Cmd/Ctrl+E recent files, Cmd/Ctrl+Down jump to symbol.");
}

function launchReviewApp(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    printAppHelp();
    return;
  }
  ensureWritableFlowState();

  const config = loadConfig();
  const contextValue = readOption(args, "--context");
  const context = contextValue ? parsePositiveInteger(contextValue, "--context") : config.diff.context;
  const appArgs = [
    appMainPath(),
    "--cwd",
    process.cwd(),
    "--context",
    String(context),
  ];
  const base = readOption(args, "--base");
  if (base) appArgs.push("--base", base);
  if (args.includes("--staged")) appArgs.push("--staged");
  if (args.includes("--include-untracked") || config.diff.includeUntracked) appArgs.push("--include-untracked");
  if (args.includes("--no-watch")) appArgs.push("--no-watch");

  const electronBinary = resolveElectronBinary();
  if (args.includes("--foreground")) {
    const result = spawnSync(electronBinary, appArgs, { stdio: "inherit" });
    process.exit(result.status ?? 0);
  }

  const child = spawn(electronBinary, appArgs, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  console.log("Opened monacori review app.");
}

function openCurrentRepository(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    printOpenHelp();
    return;
  }

  const appArgs = args.filter((arg) => arg !== "--tracked-only");
  if (!args.includes("--tracked-only") && !args.includes("--staged") && !args.includes("--include-untracked")) {
    appArgs.push("--include-untracked");
  }
  launchReviewApp(appArgs);
}

function resolveElectronBinary(): string {
  const electronModule = nodeRequire("electron") as unknown;
  if (typeof electronModule === "string") {
    return electronModule;
  }
  if (electronModule && typeof electronModule === "object" && "default" in electronModule) {
    const value = (electronModule as { default?: unknown }).default;
    if (typeof value === "string") {
      return value;
    }
  }
  throw new Error("Electron runtime is not available. Run `npm install` and try again.");
}

function appMainPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "app-main.js");
}

function printStatus(): void {
  ensureInitialized();
  const config = loadConfig();
  const git = readGitSnapshot(process.cwd());
  const reports = listRecentFiles(join(process.cwd(), FLOW_DIR, "reports"), 5);
  const logs = listRecentFiles(join(process.cwd(), FLOW_DIR, "logs"), 5);

  console.log(`# ${config.projectName} validation status`);
  console.log("");
  console.log(`Branch: ${git.branch || "(unknown)"}`);
  console.log("");
  console.log("## Git status");
  console.log(git.status || "clean");
  console.log("");
  console.log("## Diff stat");
  console.log(git.diffStat || "no diff");
  console.log("");
  console.log("## Verification commands");
  const commands = getVerificationCommands(config);
  if (commands.length === 0) {
    console.log("none configured");
  } else {
    for (const command of commands) {
      console.log(`- ${command}`);
    }
  }
  console.log("");
  console.log("## Recent reports");
  console.log(reports.length === 0 ? "none" : reports.map((path) => `- ${relative(process.cwd(), path)}`).join("\n"));
  console.log("");
  console.log("## Recent logs");
  console.log(logs.length === 0 ? "none" : logs.map((path) => `- ${relative(process.cwd(), path)}`).join("\n"));
}

function recordReport(args: string[]): void {
  ensureWritableFlowState();
  const file = readOption(args, "--file");
  const label = readOption(args, "--label") ?? "manual";
  const body = file ? readFileSync(file, "utf8") : readStdin();
  if (body.trim().length === 0) {
    throw new Error("No report content provided. Pass --file or pipe report text on stdin.");
  }

  const timestamp = timestampForFile();
  const reportDir = join(process.cwd(), FLOW_DIR, "reports");
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, `${timestamp}-${sanitizeFilePart(label)}.md`);
  writeFileSync(reportPath, [
    `# Monacori Report: ${label}`,
    "",
    `Recorded: ${new Date().toISOString()}`,
    "",
    body.trim(),
    "",
  ].join("\n"));
  appendToState(`\n## Report ${timestamp} (${label})\n\n${summarizeForState(body)}\n`);
  console.log(`Recorded ${relative(process.cwd(), reportPath)}`);
}

function executeVerification(explicitCommand = "", options: { requireCommands?: boolean } = {}): VerificationRun {
  ensureWritableFlowState();
  const config = loadConfig();
  const commands = explicitCommand.trim() ? [explicitCommand.trim()] : getVerificationCommands(config);
  if (commands.length === 0) {
    if (options.requireCommands) {
      throw new Error(`No verification commands found. Add them to ${FLOW_DIR}/${CONFIG_FILE} or pass \`-- <command>\`.`);
    }
    return { commands: [], failed: false, skipped: true };
  }

  const logPath = join(process.cwd(), FLOW_DIR, "logs", `verify-${timestampForFile()}.log`);
  const chunks: string[] = [];
  let failed = false;

  for (const command of commands) {
    chunks.push(`$ ${command}\n`);
    const result = spawnSync(command, {
      cwd: process.cwd(),
      shell: true,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 1024 * 1024 * 100,
    });
    chunks.push(result.stdout ?? "");
    chunks.push(result.stderr ?? "");
    chunks.push(`\nexit: ${result.status ?? 1}\n\n`);
    if ((result.status ?? 1) !== 0) {
      failed = true;
      break;
    }
  }

  writeFileSync(logPath, chunks.join(""));
  return { commands, failed, skipped: false, logPath };
}

function writeCheckReport(input: {
  verification: VerificationRun;
  review?: DiffReviewResult;
}): string {
  const timestamp = timestampForFile();
  const git = readGitSnapshot(process.cwd());
  const reportDir = join(process.cwd(), FLOW_DIR, "reports");
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, `${timestamp}-check.md`);
  const verificationStatus = input.verification.skipped
    ? "skipped"
    : input.verification.failed
      ? "failed"
      : "passed";
  const report = [
    "# Monacori Validation Check",
    "",
    `Recorded: ${new Date().toISOString()}`,
    `Branch: ${git.branch || "(unknown)"}`,
    `Verification: ${verificationStatus}`,
    input.verification.logPath ? `Log: ${relative(process.cwd(), input.verification.logPath)}` : "",
    input.review ? `Diff review: ${relative(process.cwd(), input.review.path)}` : "",
    input.review ? `Changed files: ${input.review.files}` : "",
    input.review ? `Changed hunks: ${input.review.hunks}` : "",
    "",
    "## Commands",
    input.verification.commands.length === 0
      ? "- none"
      : input.verification.commands.map((command) => `- \`${command}\``).join("\n"),
    "",
    "## Git Status",
    codeBlock(git.status || "clean"),
    "",
    "## Diff Stat",
    codeBlock(git.diffStat || "no diff"),
    "",
  ].filter((line) => line !== "").join("\n");
  writeFileSync(reportPath, report);
  appendToState(`\n## Check ${timestamp}\n\n- Verification: ${verificationStatus}\n${input.review ? `- Diff review: ${relative(process.cwd(), input.review.path)}\n` : ""}`);
  return reportPath;
}

function appendToState(content: string): void {
  const path = join(process.cwd(), FLOW_DIR, STATE_FILE);
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, `${current.trimEnd()}\n${content}`);
}

function initialState(config: FlowConfig): string {
  return [
    "# Monacori Validation State",
    "",
    `Project: ${config.projectName}`,
    `Initialized: ${new Date().toISOString()}`,
    "",
    "## Goal",
    "- Keep AI-generated changes reviewable, test-backed, and easy to inspect.",
    "",
    "## Checks",
    "",
    "## Reports",
    "",
  ].join("\n");
}

function initialDecisions(): string {
  return [
    "# Monacori Decisions",
    "",
    "Record durable validation decisions here so future checks do not depend on chat memory.",
    "",
  ].join("\n");
}

function agentSnippet(): string {
  return [
    "<!-- MONACORI:START -->",
    "## monacori Validation",
    "",
    "This repository uses monacori to verify AI-generated code changes.",
    "",
    "Before claiming completion on a code change:",
    "",
    "- Run `monacori check --include-untracked` or a more specific `monacori verify -- <command>`.",
    "- Use `monacori app --include-untracked` while changes are still moving.",
    "- Inspect changed hunks with F7 / Shift+F7.",
    "- Use Shift Shift in the diff review to search indexed files, including unchanged files.",
    "- In source previews, use Cmd/Ctrl+Down to jump to the declaration-like match under the cursor.",
    "- Report the verification commands, results, and remaining risks.",
    "",
    "Do not claim a change is done without verification evidence or a precise explanation of why verification could not run.",
    "<!-- MONACORI:END -->",
    "",
  ].join("\n");
}

function applyAgentDocSnippet(fileName: string): void {
  const path = join(process.cwd(), fileName);
  const snippet = agentSnippet();
  if (!existsSync(path)) {
    writeFileSync(path, `# ${fileName}\n\n${snippet}`);
    return;
  }

  const current = readFileSync(path, "utf8");
  const markerPattern = /<!-- MONACORI:START -->[\s\S]*?<!-- MONACORI:END -->\n?/;
  const next = markerPattern.test(current)
    ? current.replace(markerPattern, snippet)
    : `${current.trimEnd()}\n\n${snippet}`;
  writeFileSync(path, next);
}

function ensureInitialized(): void {
  if (!existsSync(join(process.cwd(), FLOW_DIR, CONFIG_FILE))) {
    throw new Error(`Missing ${FLOW_DIR}/. Run \`monacori init\` first.`);
  }
}

function ensureWritableFlowState(): void {
  if (!existsSync(join(process.cwd(), FLOW_DIR, CONFIG_FILE))) {
    initFlow(["--quiet"]);
    return;
  }
  ensureMonacoriGitignore(process.cwd());
}

function loadConfig(): FlowConfig {
  ensureInitialized();
  const raw = JSON.parse(readFileSync(join(process.cwd(), FLOW_DIR, CONFIG_FILE), "utf8")) as Partial<FlowConfig>;
  return {
    version: 1,
    projectName: raw.projectName ?? basename(process.cwd()),
    verification: {
      commands: Array.isArray(raw.verification?.commands) ? raw.verification.commands : [],
    },
    diff: {
      context: typeof raw.diff?.context === "number" ? raw.diff.context : 12,
      includeUntracked: typeof raw.diff?.includeUntracked === "boolean" ? raw.diff.includeUntracked : false,
    },
  };
}

function getVerificationCommands(config: FlowConfig): string[] {
  return config.verification.commands.filter((command) => command.trim().length > 0);
}

function writeIfMissing(path: string, content: string, force: boolean): void {
  if (!force && existsSync(path)) {
    return;
  }
  writeFileSync(path, content);
}

function ensureMonacoriGitignore(root: string): boolean {
  if (git(root, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    return false;
  }

  const path = join(root, GITIGNORE_FILE);
  const content = existsSync(path) ? readFileSync(path, "utf8") : "";
  const hasEntry = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === FLOW_DIR || line === `${FLOW_DIR}/`);
  if (hasEntry) {
    return false;
  }

  const prefix = content.length === 0 ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(path, `${content}${prefix}# monacori local validation artifacts\n${FLOW_DIR}/\n`);
  return true;
}

function detectVerificationCommands(root: string): string[] {
  const commands = new Set<string>();
  const packagePath = join(root, "package.json");
  if (existsSync(packagePath)) {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const packageManager = detectPackageManager(root);
    const scripts = packageJson.scripts ?? {};
    for (const script of ["typecheck", "lint", "test", "build"]) {
      if (scripts[script]) {
        commands.add(packageScriptCommand(packageManager, script));
      }
    }
  }

  if (existsSync(join(root, "pyproject.toml"))) {
    commands.add(existsSync(join(root, "poetry.lock")) ? "poetry run pytest" : "pytest");
  }
  if (existsSync(join(root, "Cargo.toml"))) {
    commands.add("cargo test");
  }
  if (existsSync(join(root, "go.mod"))) {
    commands.add("go test ./...");
  }

  return Array.from(commands);
}

function detectPackageManager(root: string): "npm" | "pnpm" | "yarn" | "bun" {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) return "bun";
  return "npm";
}

function packageScriptCommand(manager: "npm" | "pnpm" | "yarn" | "bun", script: string): string {
  if (manager === "npm") {
    return script === "test" ? "npm test" : `npm run ${script}`;
  }
  if (manager === "yarn") {
    return `yarn ${script}`;
  }
  if (manager === "bun") {
    return `bun run ${script}`;
  }
  return `pnpm ${script}`;
}

function printHelp(): void {
  console.log(`monacori

Validation control plane for AI-generated code changes.

Usage:
  mo
  monacori open [--base HEAD] [--staged] [--tracked-only]
  monacori check [--include-untracked] [--open] [--no-verify] [--no-diff] [-- <command>]
  monacori init [--force]
  monacori install [--force] [--apply-agent-docs]
  monacori verify [-- <command>]
  monacori diff [--base HEAD] [--staged] [--include-untracked] [--open] [--watch]
  monacori app [--base HEAD] [--staged] [--include-untracked]
  monacori review [--base HEAD] [--staged] [--include-untracked]
  monacori status
  monacori report [--label manual] [--file report.md]

Default loop:
  1. Let an AI agent edit code.
  2. Run: mo
  3. Run: monacori check --include-untracked
  4. Only accept the change when verification evidence is clear.

Diff review keys:
  F7         next changed hunk
  Shift+F7  previous changed hunk
  Shift Shift file search across indexed files
  Cmd/Ctrl+E recent files
  Cmd/Ctrl+Down jump to symbol under cursor
`);
}

function printOpenHelp(): void {
  console.log(`monacori open

Open the local desktop review app for the current directory. This is the default command behind \`mo\` and \`monacori\` with no arguments.

It auto-initializes .monacori/ when needed, makes sure .monacori/ is ignored in Git worktrees, and includes untracked files by default so new AI-created files are visible.

Usage:
  mo
  monacori open [--base HEAD] [--staged] [--tracked-only] [--context 12] [--no-watch] [--foreground]

Options:
  --tracked-only  inspect tracked changes only
`);
}

function printCheckHelp(): void {
  console.log(`monacori check

Run configured verification and create a reviewable diff artifact.

Usage:
  monacori check [--include-untracked] [--staged] [--base HEAD] [--context 12] [--open] [--no-verify] [--no-diff] [-- <command>]

Examples:
  monacori check --include-untracked --open
  monacori check -- npm test
  monacori check --no-verify --include-untracked
`);
}

function printDiffHelp(): void {
  console.log(`monacori diff

Generate a browser-based side-by-side Git diff review.

Usage:
  monacori diff [--base HEAD] [--staged] [--include-untracked] [--context 12] [--output review.html] [--open] [--watch] [--port 0]

Keys in the review page:
  F7         next changed hunk
  Shift+F7  previous changed hunk
  ] / [     fallback hunk navigation
  Shift Shift search indexed files, including unchanged files
  Cmd/Ctrl+E recent files
  Cmd/Ctrl+Down jump to symbol under cursor

The sidebar groups changed files as a folder tree. Use Search to filter paths and indexed file contents.
The Files tab opens read-only source previews, including unchanged files when they fit the local review budget.
Viewed marks are tied to file signatures, so a changed file becomes unviewed again after reload.
Use --watch to serve a live review that reloads when the working tree changes.
`);
}

function printAppHelp(): void {
  console.log(`monacori app

Launch the local desktop review app. The app reads Git diff and source files directly from this repository, writes a local review file under .monacori/, and refreshes when the working tree changes. It does not start an HTTP server.

Usage:
  monacori app [--base HEAD] [--staged] [--include-untracked] [--context 12] [--no-watch] [--foreground]

Aliases:
  mo
  monacori open
  monacori review
`);
}
