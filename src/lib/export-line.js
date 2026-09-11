/**
 * The size shown after an export. A page has no width or height (`figma.currentPage.width`
 * is undefined), so `export screenshot` with nothing selected printed `CLI Lab (nullxnull)`
 * next to a perfectly good PNG — reported from the panel. A size is shown when there is one.
 */

/** ` (WxH)` for a result that carries a size, `` otherwise. */
export function exportSizeLabel(result) {
  const w = Number(result && result.width);
  const h = Number(result && result.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '';
  return ` (${Math.round(w)}x${Math.round(h)})`;
}
