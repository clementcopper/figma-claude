/**
 * The icon, as shape data.
 *
 * Not SVG any more: macOS' `qlmanage` renders SVG but composites it onto white, which put a
 * white block behind the mark in the Dock, and driving a browser just to rasterise one icon was
 * worse than drawing it. `render-icon.mjs` turns these shapes into a PNG with real alpha.
 *
 * Geometry follows Apple's macOS icon grid: a 1024 canvas with the icon body 824×824 centred
 * (so a 100 px margin all round) and a corner radius of 185.4 — 0.225 × 824. That margin is
 * what the Dock, Launchpad and the switcher expect; without it an icon looks oversized next to
 * every other app.
 */
export const CANVAS = 1024;
export const BODY = 824;
export const MARGIN = (CANVAS - BODY) / 2; // 100
export const RADIUS = BODY * 0.225; // 185.4

const L = MARGIN;
const T = MARGIN;
const R = MARGIN + BODY;
const B = MARGIN + BODY;

const SURFACE = '#242428';
const CHROME = '#33333A';
const PROMPT = '#D97757';
const INPUT = '#8C8C94';
const TRACK = '#3C3C44';
const PROGRESS = '#0D99FF';
const LIGHTS = ['#F24E1E', '#FFCD29', '#0ACF83'];

const CHROME_H = 168;

/** The mark at full size: window body, title bar, prompt, input rule, progress line. */
export const icon = [
  { type: 'roundRect', x: L, y: T, w: BODY, h: BODY, r: RADIUS, fill: SURFACE },
  // Title bar: same top corners as the body, square at the bottom where it meets the canvas.
  { type: 'roundRect', x: L, y: T, w: BODY, h: CHROME_H, r: RADIUS, fill: CHROME, flatBottom: true },
  ...LIGHTS.map((fill, i) => ({
    type: 'circle', cx: L + 96 + i * 92, cy: T + CHROME_H / 2, r: 26, fill
  })),
  // Prompt chevron, drawn as two capsules so the joint stays round at every size.
  { type: 'capsule', x1: L + 112, y1: T + 300, x2: L + 232, y2: T + 386, w: 52, fill: PROMPT },
  { type: 'capsule', x1: L + 232, y1: T + 386, x2: L + 112, y2: T + 472, w: 52, fill: PROMPT },
  { type: 'capsule', x1: L + 300, y1: T + 386, x2: L + 588, y2: T + 386, w: 52, fill: INPUT },
  { type: 'capsule', x1: L + 112, y1: T + 620, x2: L + 712, y2: T + 620, w: 44, fill: TRACK },
  { type: 'capsule', x1: L + 112, y1: T + 620, x2: L + 330, y2: T + 620, w: 44, fill: PROGRESS }
];

/**
 * 16 and 32 px: the input rule and the progress track disappear at that size anyway, and what
 * survives has to be thicker. `.icns` carries one image per size, so this is worth drawing.
 */
export const iconSmall = [
  { type: 'roundRect', x: L, y: T, w: BODY, h: BODY, r: RADIUS, fill: SURFACE },
  { type: 'roundRect', x: L, y: T, w: BODY, h: 196, r: RADIUS, fill: CHROME, flatBottom: true },
  ...LIGHTS.map((fill, i) => ({
    type: 'circle', cx: L + 116 + i * 116, cy: T + 98, r: 38, fill
  })),
  { type: 'capsule', x1: L + 176, y1: T + 340, x2: L + 356, y2: T + 470, w: 84, fill: PROMPT },
  { type: 'capsule', x1: L + 356, y1: T + 470, x2: L + 176, y2: T + 600, w: 84, fill: PROMPT },
  { type: 'capsule', x1: L + 452, y1: T + 470, x2: L + 668, y2: T + 470, w: 84, fill: INPUT }
];

export const VARIANTS = { icon, iconSmall };
