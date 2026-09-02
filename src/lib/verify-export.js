/**
 * The one place that decides how large a verification screenshot comes out.
 *
 * There were two. `figma-cli verify` clamped a requested scale against `--max` and then against
 * Figma's own 7500px ceiling; `render --verify` had its own copy that hardcoded scale 1, knew
 * only the 2000px cap, and offered no way to ask for more — while `render --help` promised it
 * "replaces a separate `figma-cli verify` roundtrip". Reported from the panel after a 500px frame
 * came back too small to judge: 36px rings and 9px text were unreadable, the frame was assumed
 * broken, and the same node at `verify -s 3` showed it had been right all along.
 *
 * One function now answers "how big", both commands call it, and the answer says what it did —
 * a silently clamped scale is how a screenshot lies about the thing it is supposed to prove.
 */

/** Figma's own export ceiling. Past this the API refuses the render outright. */
export const FIGMA_MAX_PIXELS = 7500;

/**
 * @param {{width:number, height:number}} node the node's real, unscaled size
 * @param {number} requested the scale the caller asked for
 * @param {number} maxDim the caller's own pixel budget
 * @returns {{scale:number, clamped:boolean, reason:string|null}}
 */
export function resolveExportScale(node, requested, maxDim) {
  const width = Number(node && node.width) || 100;
  const height = Number(node && node.height) || 100;
  const longest = Math.max(width, height);

  let scale = Number(requested);
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;

  let reason = null;
  if (longest * scale > maxDim) {
    scale = maxDim / longest;
    reason = `capped to ${maxDim}px`;
  }
  // Checked after the budget, because a budget above Figma's ceiling must not win.
  if (longest * scale > FIGMA_MAX_PIXELS) {
    scale = FIGMA_MAX_PIXELS / longest;
    reason = `capped to Figma's ${FIGMA_MAX_PIXELS}px export limit`;
  }

  return { scale, clamped: reason !== null, reason };
}

/**
 * The same decision as JavaScript source, for embedding in the plugin-side eval.
 *
 * The rules cannot be imported over there, and two hand-written copies is what caused this in
 * the first place — so the snippet is generated from the same constants and unit-tested through
 * `resolveExportScale`.
 */
export function exportScaleSnippet(requested, maxDim) {
  return `(() => {
      const w = node.width || 100, h = node.height || 100;
      const longest = Math.max(w, h);
      let scale = ${Number(requested) > 0 ? Number(requested) : 1};
      let reason = null;
      if (longest * scale > ${maxDim}) { scale = ${maxDim} / longest; reason = 'capped to ${maxDim}px'; }
      if (longest * scale > ${FIGMA_MAX_PIXELS}) { scale = ${FIGMA_MAX_PIXELS} / longest; reason = "capped to Figma's ${FIGMA_MAX_PIXELS}px export limit"; }
      return { scale, reason };
    })()`;
}
