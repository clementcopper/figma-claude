/**
 * WCAG 2 contrast maths — one source for `a11y contrast` and `a11y audit`.
 *
 * Each command carried its own copy and they had drifted: `contrast` blended foreground AND
 * background onto white, `audit` blended the foreground onto white and the background not at
 * all, so semi-transparent text on a dark ground passed in one and failed in the other.
 *
 * Same convention as src/lib/text-styles.js: plain function declarations, no imports, no
 * closures, so `WCAG_SNIPPET` (their source) can be embedded into plugin code and the unit
 * test runs the embedded copy against the exported one.
 */

function luminance(r, g, b) {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(l1, l2) {
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Composite `fg` (with alpha) over an opaque `bg`. */
function blend(fg, bg) {
  const a = fg.a === undefined ? 1 : fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
}

/**
 * Contrast of a text colour against its resolved background. The background is composited
 * onto white (a page is white when nothing else paints), the text onto that background.
 */
function textContrast(textColor, bgColor) {
  const bg = blend(bgColor, { r: 1, g: 1, b: 1 });
  const fg = blend(textColor, bg);
  return { ratio: contrastRatio(luminance(fg.r, fg.g, fg.b), luminance(bg.r, bg.g, bg.b)), fg, bg };
}

export { luminance, contrastRatio, blend, textContrast };

/** The four functions above as source, for embedding into plugin-side code. */
export const WCAG_SNIPPET = [luminance, contrastRatio, blend, textContrast].map((f) => f.toString()).join('\n');
