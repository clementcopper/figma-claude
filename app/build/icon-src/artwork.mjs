/**
 * Icon artwork, as shape data.
 *
 * Not SVG: macOS' `qlmanage` renders SVG but composites onto white, which is where the white
 * block behind the mark came from. `render-icon.mjs` turns these shapes into a PNG with real
 * alpha — see `build/README.md`.
 *
 * Geometry follows Apple's macOS icon grid: 1024 canvas, body 824×824 centred (100 px margin),
 * corner radius 185.4 = 0.225 × 824. Every app in the Dock keeps that margin; an icon without
 * it reads as oversized.
 *
 * Palette: Claude's terracotta and Figma's five brand colours. Nothing here reproduces Figma's
 * logo — that is a trademark; only the colours are shared vocabulary.
 */
export const CANVAS = 1024;
export const BODY = 824;
export const MARGIN = (CANVAS - BODY) / 2; // 100
export const RADIUS = BODY * 0.225; // 185.4

const L = MARGIN;
const T = MARGIN;

// Claude
const TERRACOTTA = '#D97757';
const TERRACOTTA_DEEP = '#C4623F';
// Figma
const FIG_RED = '#F24E1E';
const FIG_SALMON = '#FF7262';
const FIG_PURPLE = '#A259FF';
const FIG_BLUE = '#1ABCFE';
const FIG_GREEN = '#0ACF83';
const FIGMA_FIVE = [FIG_RED, FIG_SALMON, FIG_PURPLE, FIG_BLUE, FIG_GREEN];
// Neutrals
const INK = '#1E1E22';
const INK_SOFT = '#2A2A30';
const CHROME = '#33333A';
const PAPER = '#F7F7F8';

const body = (fill, extra = {}) => ({
  type: 'roundRect', x: L, y: T, w: BODY, h: BODY, r: RADIUS, fill, ...extra
});

/** Chevron as two capsules, so the joint stays round at every size. */
const chevron = (x, y, size, weight, fill) => [
  { type: 'capsule', x1: x, y1: y - size, x2: x + size * 0.78, y2: y, w: weight, fill },
  { type: 'capsule', x1: x + size * 0.78, y1: y, x2: x, y2: y + size, w: weight, fill }
];

/**
 * A — Prompt on ink, Figma's colours as the underline.
 * The chevron carries Claude, the five-colour rule carries Figma; the mark is the prompt itself.
 */
export const promptRule = [
  body({
    x1: L, y1: T, x2: L, y2: T + BODY,
    stops: [{ at: 0, color: INK_SOFT }, { at: 1, color: INK }]
  }),
  ...chevron(L + 214, T + 330, 132, 74, TERRACOTTA),
  { type: 'capsule', x1: L + 420, y1: T + 330, x2: L + 636, y2: T + 330, w: 74, fill: '#8C8C94' },
  ...FIGMA_FIVE.map((fill, i) => ({
    type: 'capsule',
    x1: L + 150 + i * 108, y1: T + 588, x2: L + 226 + i * 108, y2: T + 588, w: 56, fill
  }))
];

/**
 * B — Claude's terracotta as the ground, the prompt cut out of it in paper white, Figma's
 * colours as a thin strip along the bottom edge. The most colourful of the three.
 */
export const terracotta = [
  body({
    x1: L, y1: T, x2: L + BODY, y2: T + BODY,
    stops: [{ at: 0, color: '#E08A6C' }, { at: 1, color: TERRACOTTA_DEEP }]
  }),
  ...chevron(L + 236, T + 356, 148, 82, PAPER),
  { type: 'capsule', x1: L + 452, y1: T + 356, x2: L + 664, y2: T + 356, w: 82, fill: '#F7F7F8' },
  // The strip sits inside the corner radius, so it is drawn as five capsules rather than a bar.
  ...FIGMA_FIVE.map((fill, i) => ({
    type: 'capsule',
    x1: L + 168 + i * 104, y1: T + 636, x2: L + 232 + i * 104, y2: T + 636, w: 48, fill
  }))
];

/**
 * C — The window: dark body, a title bar in Figma's colours instead of the usual three greys,
 * Claude's prompt inside. The literal reading of "terminal next to Figma".
 */
export const window = [
  body(INK),
  { type: 'roundRect', x: L, y: T, w: BODY, h: 176, r: RADIUS, fill: CHROME, flatBottom: true },
  // The lights start well clear of the corner: at their height the body's left edge is already
  // curving inward, so a dot placed by the straight edge looks glued to it.
  ...FIGMA_FIVE.slice(0, 3).map((fill, i) => ({
    type: 'circle', cx: L + 176 + i * 104, cy: T + 92, r: 28, fill
  })),
  ...chevron(L + 190, T + 470, 116, 66, TERRACOTTA),
  { type: 'capsule', x1: L + 384, y1: T + 470, x2: L + 640, y2: T + 470, w: 66, fill: '#8C8C94' },
  { type: 'capsule', x1: L + 150, y1: T + 660, x2: L + 674, y2: T + 660, w: 44, fill: '#3C3C44' },
  { type: 'capsule', x1: L + 150, y1: T + 660, x2: L + 360, y2: T + 660, w: 44, fill: FIG_BLUE }
];

/**
 * D — Split: Claude's terracotta and Figma's blue meet on the diagonal, the prompt sits on the
 * seam in white. Most abstract, reads smallest.
 */
export const split = [
  body({
    x1: L, y1: T + BODY, x2: L + BODY, y2: T,
    stops: [
      { at: 0, color: TERRACOTTA },
      { at: 0.5, color: '#B0587A' },
      { at: 1, color: FIG_PURPLE }
    ]
  }),
  ...chevron(L + 250, T + 412, 168, 92, PAPER),
  { type: 'capsule', x1: L + 470, y1: T + 412, x2: L + 604, y2: T + 412, w: 92, fill: PAPER }
];

/**
 * C for 16 and 32 px: the input rule and the progress track vanish at that size anyway, and
 * what is left has to be heavier. `.icns` carries one image per size, which is what makes a
 * second drawing worth it.
 */
export const windowSmall = [
  body(INK),
  { type: 'roundRect', x: L, y: T, w: BODY, h: 216, r: RADIUS, fill: CHROME, flatBottom: true },
  ...FIGMA_FIVE.slice(0, 3).map((fill, i) => ({
    type: 'circle', cx: L + 196 + i * 124, cy: T + 112, r: 42, fill
  })),
  ...chevron(L + 216, T + 520, 150, 88, TERRACOTTA),
  { type: 'capsule', x1: L + 452, y1: T + 520, x2: L + 660, y2: T + 520, w: 88, fill: '#9A9AA4' }
];

export const VARIANTS = { promptRule, terracotta, window, windowSmall, split };
