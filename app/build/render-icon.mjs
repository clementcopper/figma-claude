/**
 * Rasterises the icon shapes to a PNG with real alpha — Node only, no image library.
 *
 * Why not something off the shelf: `qlmanage` bakes a white background into SVG output (that is
 * where the white block behind the icon came from), and starting a browser to render one file
 * is a heavier dependency than the fifty lines below.
 *
 *   node build/render-icon.mjs icon build/icon.png [size]
 */
import { deflateSync } from 'zlib';
import { writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { CANVAS, VARIANTS } from './icon-src/artwork.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SAMPLES = 4; // 4×4 per pixel

function hex(value) {
  const n = parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// --- coverage functions, each returns 0…1 for a point ---

function insideRoundRect(s, x, y) {
  const { x: rx, y: ry, w, h, r, flatBottom } = s;
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const corners = [
    [rx + r, ry + r, x < rx + r && y < ry + r],
    [rx + w - r, ry + r, x > rx + w - r && y < ry + r],
    [rx + r, ry + h - r, !flatBottom && x < rx + r && y > ry + h - r],
    [rx + w - r, ry + h - r, !flatBottom && x > rx + w - r && y > ry + h - r]
  ];
  for (const [cx, cy, applies] of corners) {
    if (applies) return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  }
  return true;
}

function insideCircle(s, x, y) {
  return (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r;
}

/** A line segment with round caps — the shape a stroked path with `stroke-linecap: round` has. */
function insideCapsule(s, x, y) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((x - s.x1) * dx + (y - s.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = s.x1 + t * dx;
  const py = s.y1 + t * dy;
  return (x - px) ** 2 + (y - py) ** 2 <= (s.w / 2) ** 2;
}

const TESTS = { roundRect: insideRoundRect, circle: insideCircle, capsule: insideCapsule };

function bounds(s) {
  if (s.type === 'roundRect') return [s.x, s.y, s.x + s.w, s.y + s.h];
  if (s.type === 'circle') return [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r];
  const half = s.w / 2;
  return [
    Math.min(s.x1, s.x2) - half, Math.min(s.y1, s.y2) - half,
    Math.max(s.x1, s.x2) + half, Math.max(s.y1, s.y2) + half
  ];
}

function render(shapes, size) {
  const scale = size / CANVAS;
  const px = new Float32Array(size * size * 4); // straight RGBA, 0…255 / 0…1 alpha

  for (const shape of shapes) {
    const test = TESTS[shape.type];
    const [r, g, b] = hex(shape.fill);
    const [bx0, by0, bx1, by1] = bounds(shape);
    const x0 = Math.max(0, Math.floor(bx0 * scale));
    const y0 = Math.max(0, Math.floor(by0 * scale));
    const x1 = Math.min(size - 1, Math.ceil(bx1 * scale));
    const y1 = Math.min(size - 1, Math.ceil(by1 * scale));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let hits = 0;
        for (let sy = 0; sy < SAMPLES; sy++) {
          for (let sx = 0; sx < SAMPLES; sx++) {
            const px_ = (x + (sx + 0.5) / SAMPLES) / scale;
            const py_ = (y + (sy + 0.5) / SAMPLES) / scale;
            if (test(shape, px_, py_)) hits++;
          }
        }
        if (hits === 0) continue;
        const a = hits / (SAMPLES * SAMPLES);
        const i = (y * size + x) * 4;
        // Painter's algorithm, source-over on straight alpha.
        const dstA = px[i + 3];
        const outA = a + dstA * (1 - a);
        px[i] = (r * a + px[i] * dstA * (1 - a)) / outA;
        px[i + 1] = (g * a + px[i + 1] * dstA * (1 - a)) / outA;
        px[i + 2] = (b * a + px[i + 2] * dstA * (1 - a)) / outA;
        px[i + 3] = outA;
      }
    }
  }

  return px;
}

function toPng(px, size) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const o = y * (stride + 1) + 1 + x * 4;
      raw[o] = Math.round(px[i]);
      raw[o + 1] = Math.round(px[i + 1]);
      raw[o + 2] = Math.round(px[i + 2]);
      raw[o + 3] = Math.round(px[i + 3] * 255);
    }
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

let CRC_TABLE;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const key = process.argv[2] ?? 'icon';
const out = resolve(ROOT, process.argv[3] ?? `build/${key}.png`);
const size = Number(process.argv[4] ?? 1024);

const shapes = VARIANTS[key];
if (!shapes) {
  console.error(`unknown variant: ${key} (have: ${Object.keys(VARIANTS).join(', ')})`);
  process.exit(1);
}

writeFileSync(out, toPng(render(shapes, size), size));
console.log(`wrote ${out} (${String(size)}px)`);
