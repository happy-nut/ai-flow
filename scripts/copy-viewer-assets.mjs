// Copies the client viewer assets (script + stylesheet) into dist/ after tsc, since tsc only emits
// .ts output. cli.ts reads these at runtime via readViewerAsset() relative to its own dist location.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
mkdirSync(distDir, { recursive: true });
for (const file of ["viewer.client.js", "viewer.css"]) {
  copyFileSync(join(root, "src", file), join(distDir, file));
}
console.log("copied viewer assets to dist/");
