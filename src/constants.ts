export const FLOW_DIR = ".monacori";
export const GITIGNORE_FILE = ".gitignore";
// The agent's implementation plan, written under FLOW_DIR. Force-surfaced as a source file so it renders
// as Markdown, shows in Quick Open, and takes line comments — even though FLOW_DIR is gitignored.
export const PLAN_FILE = "plan.md";
export const CONFIG_FILE = "config.json";
export const STATE_FILE = "state.md";
export const DECISIONS_FILE = "decisions.md";
export const AGENT_SNIPPET_FILE = "agent-snippet.md";
export const SOURCE_MAX_FILE_BYTES = 220_000;
export const SOURCE_MAX_TOTAL_BYTES = 50_000_000;
export const SOURCE_MAX_FILES = 20000;
// Raster images up to this size are embedded as base64 data URIs for inline preview.
export const IMAGE_MAX_BYTES = 2_000_000;
