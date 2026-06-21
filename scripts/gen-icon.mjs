// Generates assets/icon.png (1024x1024) for the monacori desktop app.
// No external image tooling required — encodes the PNG directly with zlib.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const W = 1024;
const H = 1024;
const buf = Buffer.alloc(W * H * 4);

function blend(x, y, r, g, b, a) {
  if (x < 0 || x >= W || y < 0 || y >= H || a <= 0) return;
  const i = (y * W + x) * 4;
  const sa = a / 255;
  const da = buf[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  buf[i] = Math.round((r * sa + buf[i] * da * (1 - sa)) / oa);
  buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / oa);
  buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / oa);
  buf[i + 3] = Math.round(oa * 255);
}

// Rounded-square background: a slightly inset card (so the icon reads a touch smaller) with a
// soft diagonal blue -> indigo gradient and a glossy top sheen for depth.
const MARGIN = 88;
const RADIUS = 196;
const SIZE = W - 2 * MARGIN;
const lerp = (a, b, t) => a + (b - a) * t;
function roundRectCoverage(x, y) {
  if (x < MARGIN || x >= W - MARGIN || y < MARGIN || y >= H - MARGIN) return 0;
  let dx = 0;
  let dy = 0;
  if (x < MARGIN + RADIUS && y < MARGIN + RADIUS) { dx = MARGIN + RADIUS - x; dy = MARGIN + RADIUS - y; }
  else if (x >= W - MARGIN - RADIUS && y < MARGIN + RADIUS) { dx = x - (W - MARGIN - RADIUS - 1); dy = MARGIN + RADIUS - y; }
  else if (x < MARGIN + RADIUS && y >= H - MARGIN - RADIUS) { dx = MARGIN + RADIUS - x; dy = y - (H - MARGIN - RADIUS - 1); }
  else if (x >= W - MARGIN - RADIUS && y >= H - MARGIN - RADIUS) { dx = x - (W - MARGIN - RADIUS - 1); dy = y - (H - MARGIN - RADIUS - 1); }
  if (dx > 0 && dy > 0) {
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > RADIUS) return 0;
    return Math.max(0, Math.min(1, RADIUS - d + 0.5));
  }
  return 1;
}
for (let y = MARGIN; y < H - MARGIN; y++) {
  for (let x = MARGIN; x < W - MARGIN; x++) {
    const cov = roundRectCoverage(x, y);
    if (cov <= 0) continue;
    const t = Math.max(0, Math.min(1, ((x - MARGIN) + (y - MARGIN)) / (2 * SIZE)));
    let r = lerp(0x4f, 0x6a, t);
    let g = lerp(0x9d, 0x4f, t);
    let b = lerp(0xf0, 0xd8, t);
    const sheen = Math.max(0, 1 - (y - MARGIN) / (SIZE * 0.6));
    const s = sheen * sheen * 0.14;
    r = lerp(r, 255, s);
    g = lerp(g, 255, s);
    b = lerp(b, 255, s);
    blend(x, y, Math.round(r), Math.round(g), Math.round(b), Math.round(255 * cov));
  }
}

// White "M" monogram (rounded strokes) with a soft drop shadow so it sits above the background.
function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
const THICK = 72;
const segs = [
  [372, 648, 372, 392],
  [372, 392, 512, 556],
  [512, 556, 652, 392],
  [652, 392, 652, 648],
];
function distToM(px, py) {
  let dmin = 1e9;
  for (const s of segs) {
    const d = distSeg(px, py, s[0], s[1], s[2], s[3]);
    if (d < dmin) dmin = d;
  }
  return dmin;
}
// Soft drop shadow, nudged down and slightly spread.
for (let y = 350; y <= 720; y++) {
  for (let x = 320; x <= 704; x++) {
    const d = distToM(x, y - 16);
    const aa = Math.max(0, Math.min(1, (THICK / 2 + 14 - d) / 16));
    if (aa > 0) blend(x, y, 16, 22, 48, Math.round(48 * aa));
  }
}
// Crisp white monogram on top.
for (let y = 340; y <= 692; y++) {
  for (let x = 326; x <= 698; x++) {
    const d = distToM(x, y);
    const aa = Math.max(0, Math.min(1, THICK / 2 - d + 0.5));
    if (aa > 0) blend(x, y, 255, 255, 255, Math.round(255 * aa));
  }
}

// Minimal PNG encoder (truecolor + alpha, single IDAT).
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const raw = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0; // filter: none
  buf.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "icon.png"), png);
console.log("wrote assets/icon.png:", png.length, "bytes");
