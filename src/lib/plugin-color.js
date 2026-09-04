/**
 * Colour helpers for plugin-side code — one source for the fifteen `hexToRgb` and eight
 * `toHex`/`rgbToHex` copies the command modules carried (three of them without a null check,
 * so a bad hex was a TypeError inside Figma).
 *
 * Same convention as src/lib/wcag.js and src/lib/text-styles.js: plain function declarations,
 * no imports, no closures, so `COLOR_SNIPPET` (their source) can be spliced into a template
 * literal and the unit test runs the embedded copy against the exported one.
 */

function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const m = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(h);
  if (!m) return null;
  const c = { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
  if (m[4] !== undefined) c.a = parseInt(m[4], 16) / 255;
  return c;
}

function rgbToHex(r, g, b) {
  const h = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

function toHex(c) {
  return rgbToHex(c.r, c.g, c.b);
}

export { hexToRgb, rgbToHex, toHex };

/** The three functions above as source, for embedding into plugin-side code. */
export const COLOR_SNIPPET = [hexToRgb, rgbToHex, toHex].map((f) => f.toString()).join('\n');
