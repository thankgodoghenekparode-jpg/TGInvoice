/**
 * Generates the PWA icon set for TG Invoice without any image dependency.
 *
 *   node scripts/generate-icons.mjs
 *
 * Draws the brand mark (a blue invoice sheet) into raw RGBA pixels and encodes
 * PNGs by hand with Node's zlib. Output lands in /public:
 *   icon-192.png, icon-512.png      → purpose "any"    (rounded corners)
 *   icon-maskable-512.png           → purpose "maskable" (full bleed)
 *   apple-touch-icon.png (180)      → iOS home screen   (full bleed)
 *
 * Re-run it whenever the brand changes; the generated files are committed.
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'public');

/* ── PNG encoding ────────────────────────────────────────────────────── */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ── Drawing helpers ─────────────────────────────────────────────────── */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * clamp01(t)));

function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function inTriangleRight(px, py, x, y, size) {
  // Right triangle filling the top-right corner: (x, y) → (x+size, y) → (x+size, y+size)
  if (px < x || px > x + size || py < y || py > y + size) return false;
  return px - x <= py - y ? false : true; // lower-right half (fold)
}

/** Colour for a point, in unit coordinates (0..1). */
function colorAt(u, v, rounded, S) {
  // Rounded "any" icons are transparent outside the squircle.
  if (rounded) {
    const r = 0.22 * S;
    if (!inRoundRect(u, v, 0, 0, S, S, r)) return [0, 0, 0, 0];
  }

  // Background: vertical brand gradient + subtle diagonal sheen.
  let color = mix([37, 99, 235], [30, 64, 175], v);
  color = mix(color, [96, 165, 250], (1 - u) * 0.14 * (1 - v));

  // Soft radial highlight, top-left.
  const glx = 0.26;
  const gly = 0.22;
  const gd = Math.hypot(u - glx, v - gly) / 0.55;
  if (gd < 1) color = mix(color, [219, 234, 254], (1 - gd) * 0.22);

  // Sheet geometry (shares the safe-zone proportions used everywhere).
  const x0 = 0.30 * S;
  const y0 = 0.235 * S;
  const w = 0.40 * S;
  const h = 0.53 * S;
  const pad = 0.075 * S;

  // Sheet shadow.
  if (inRoundRect(u, v, x0 + 0.012 * S, y0 + 0.018 * S, w, h, 0.055 * S)) {
    color = mix(color, [15, 23, 42], 0.16);
  }

  // White sheet.
  if (inRoundRect(u, v, x0, y0, w, h, 0.055 * S)) color = [255, 255, 255];

  // Folded corner (top-right).
  const f = 0.14 * S;
  if (inTriangleRight(u, v, x0 + w - f, y0, f)) color = [219, 234, 254];
  // Fold crease.
  if (u >= x0 + w - f && u <= x0 + w && Math.abs(u - (x0 + w - f) - (v - y0)) <= 0.006 * S) {
    color = [191, 219, 254];
  }

  const lx = x0 + pad;
  const lw = w - 2 * pad;
  const lh = 0.045 * S;
  const lines = [
    { y: y0 + 0.15 * S, width: lw },
    { y: y0 + 0.25 * S, width: lw * 0.66 },
    { y: y0 + 0.35 * S, width: lw * 0.84 },
  ];
  for (const line of lines) {
    if (inRoundRect(u, v, lx, line.y - lh / 2, line.width, lh, lh / 2)) color = [147, 197, 253];
  }

  // Emphasis "amount" bar in brand blue.
  const bh = 0.075 * S;
  const by = y0 + h - 0.135 * S;
  if (inRoundRect(u, v, lx, by - bh / 2, lw * 0.52, bh, bh / 2)) color = [37, 99, 235];

  return [...color, 255];
}

function render(size, { rounded }) {
  const ss = 2; // supersample factor for smooth edges
  const S = size * ss;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const u = x * ss + sx + 0.5;
          const v = y * ss + sy + 0.5;
          const px = colorAt(u, v, rounded, S);
          const alpha = px[3] / 255;
          r += px[0] * alpha;
          g += px[1] * alpha;
          b += px[2] * alpha;
          a += px[3];
        }
      }
      const n = ss * ss;
      const alphaAvg = a / n;
      const idx = (y * size + x) * 4;
      const norm = alphaAvg > 0 ? 255 / alphaAvg : 0;
      rgba[idx] = Math.round((r / n) * norm);
      rgba[idx + 1] = Math.round((g / n) * norm);
      rgba[idx + 2] = Math.round((b / n) * norm);
      rgba[idx + 3] = Math.round(alphaAvg);
    }
  }
  return encodePng(size, size, rgba);
}

/* ── Emit the set ────────────────────────────────────────────────────── */

const targets = [
  { file: 'icon-192.png', size: 192, rounded: true },
  { file: 'icon-512.png', size: 512, rounded: true },
  { file: 'icon-maskable-512.png', size: 512, rounded: false },
  { file: 'apple-touch-icon.png', size: 180, rounded: false },
];

for (const target of targets) {
  const png = render(target.size, { rounded: target.rounded });
  fs.writeFileSync(path.join(outDir, target.file), png);
  console.log(`  ✓ ${target.file.padEnd(24)} ${target.size}×${target.size}  ${(png.length / 1024).toFixed(1)} KB`);
}

console.log('\nIcons written to /public.');
