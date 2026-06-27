import { git } from "./git.js";
import { renderDiff2Html } from "./highlight.js";

// One commit row for the history view. parents drives the graph lanes (computed in the renderer).
export type GitCommit = {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: string; // ISO-8601
  refs: string; // %D — "HEAD -> main, origin/main, tag: v1" (may be empty)
  subject: string;
};

// Field/record separators that can't occur in git output, so subjects with spaces/commas parse cleanly.
const FS = "\x1f";
const RS = "\x1e";

// Read up to `limit` commits (optionally skipping `skip`). Newest first — the order the graph walker expects.
export function readGitLog(root: string, options: { limit?: number; skip?: number } = {}): GitCommit[] {
  const limit = options.limit && options.limit > 0 ? options.limit : 200;
  const args = [
    "-c", "log.showSignature=false",
    "log", "--no-color",
    "--date=iso-strict",
    `--pretty=format:%H${FS}%P${FS}%an${FS}%ae${FS}%ad${FS}%D${FS}%s${RS}`,
    `-n`, String(limit),
  ];
  if (options.skip && options.skip > 0) args.push(`--skip=${options.skip}`);
  const out = git(root, args);
  if (!out) return [];
  return out
    .split(RS)
    .map((rec) => rec.replace(/^\n/, ""))
    .filter((rec) => rec.trim().length > 0)
    .map((rec) => {
      const f = rec.split(FS);
      return {
        hash: f[0] || "",
        parents: (f[1] || "").trim() ? (f[1] as string).trim().split(/\s+/) : [],
        author: f[2] || "",
        email: f[3] || "",
        date: f[4] || "",
        refs: f[5] || "",
        subject: f[6] || "",
      };
    })
    .filter((c) => c.hash);
}

// Full detail for one commit: metadata, full message body, and the rendered diff (diff2html HTML).
// Merge commits show no diff under plain `git show`; the renderer notes that case.
export function readCommitDiff(root: string, sha: string): {
  hash: string;
  author: string;
  email: string;
  date: string;
  refs: string;
  message: string;
  diffHtml: string;
  isMerge: boolean;
} | null {
  if (!sha || !/^[0-9a-fA-F]{4,64}$/.test(sha)) return null; // guard: only a hash reaches `git`
  const meta = git(root, ["show", "-s", `--pretty=format:%H${FS}%an${FS}%ae${FS}%ad${FS}%D${FS}%P${FS}%B`, "--date=iso-strict", sha]);
  if (!meta) return null;
  const f = meta.split(FS);
  const parents = (f[5] || "").trim() ? (f[5] as string).trim().split(/\s+/) : [];
  const diffText = git(root, ["show", sha, "--no-color", "--pretty=format:"]).replace(/^\n+/, "");
  return {
    hash: f[0] || sha,
    author: f[1] || "",
    email: f[2] || "",
    date: f[3] || "",
    refs: f[4] || "",
    message: (f[6] || "").trim(),
    diffHtml: renderDiff2Html(diffText),
    isMerge: parents.length > 1,
  };
}
