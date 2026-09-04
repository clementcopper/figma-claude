/**
 * Numeric JSX props: which ones there are, and how a parsed value becomes a number.
 *
 * `parseProps` yields strings for everything — `gap={8}` and `gap="8"` both arrive as "8".
 * The generators then spliced that text straight into Plugin API code, so `gap="8px"`
 * produced `frame.itemSpacing = 8px` (a SyntaxError that failed the whole render) and
 * `gap="0; figma.currentPage.children.length; //"` ran inside Figma. Coercing once, here,
 * at the parser's exit is cheaper and safer than guarding forty emit sites.
 *
 * Same split as `src/lib/jsx-props.js`: pure data + a pure function, unit-tested.
 */

/** Props whose value must be a number (a `px` suffix is tolerated). */
const strictly = [
  'gap', 'rowGap', 'wrapGap', 'counterAxisSpacing',
  'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'padding',
  'x', 'y', 'top', 'right', 'bottom', 'left', 'centerOffsetX', 'centerOffsetY',
  'minW', 'maxW', 'minH', 'maxH',
  'strokeWidth', 'opacity', 'rotate', 'grow',
  'rounded', 'radius', 'roundedTL', 'roundedTR', 'roundedBL', 'roundedBR', 'cornerSmoothing',
  'blur', 'bgBlur', 'noiseDensity', 'noiseSize', 'noiseOpacity', 'textureSize', 'textureRadius',
  'progressiveBlur', 'progressiveBlurStart',
  'glassRefraction', 'glassDepth', 'glassRadius', 'glassDispersion', 'glassLight', 'glassLightAngle',
  'size', 's', 'maxLines', 'arc', 'arcStart', 'innerRadius',
];

/** Sizing props: a number, or one of the layout keywords, or a percentage. */
const sized = ['w', 'h', 'width', 'height'];
const SIZE_KEYWORDS = new Set(['fill', 'hug', 'auto']);

/** Typography dimensions: a number, `auto`, or a percentage. */
const typographic = ['lineHeight', 'letterSpacing'];

export const NUMERIC_PROPS = new Set([...strictly, ...sized, ...typographic]);

const isPercent = (s) => /^-?\d*\.?\d+%$/.test(s);

function toNumber(raw) {
  const s = String(raw).trim().replace(/px$/i, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Returns a copy of `props` with every numeric prop coerced. Throws on a value that is
 * neither a number nor a keyword the prop accepts — an error names the prop and the value,
 * which is what the render command prints.
 */
export function coerceNumericProps(props) {
  const out = { ...props };
  for (const [key, raw] of Object.entries(props)) {
    if (!NUMERIC_PROPS.has(key) || raw === undefined || raw === null) continue;
    if (typeof raw === 'number') continue;
    const s = String(raw).trim();
    const n = toNumber(s);
    if (n !== null) { out[key] = n; continue; }
    if (sized.includes(key) && (SIZE_KEYWORDS.has(s) || isPercent(s))) { out[key] = s; continue; }
    if (typographic.includes(key) && (s === 'auto' || s === 'AUTO' || isPercent(s))) { out[key] = s; continue; }
    throw new Error(`Invalid value ${key}="${s}" — expected a number` +
      (sized.includes(key) ? ', fill, hug or a percentage' : ''));
  }
  return out;
}
