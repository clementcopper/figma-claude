/**
 * Ordered instancing attempts from a reuse handle. Pure.
 * key first (cross-file / published library), id as the always-works same-file
 * fallback. The I/O shell tries each in order until one succeeds.
 */
/**
 * A node id as the user can type it: `15121:131077`, or the nested `I2058:20351;2054:20325`.
 *
 * `instantiate` took a component NAME and looked it up in a DESIGN.md, which is the documented
 * route but not the only one people have — a panel session had the component's id from the live
 * file, no DESIGN.md, and needed twenty copies. An id is unambiguous, so it skips the lookup.
 */
export function looksLikeNodeId(value) {
  return /^I?\d+:\d+(;\d+:\d+)*$/.test(String(value || '').trim());
}

/** The plan for an id the user named directly: nothing to resolve, one way to try. */
export function planFromNodeId(id) {
  return [{ via: 'id', id: String(id).trim() }];
}

export function resolveInstancePlan(reuse) {
  if (!reuse) return [];
  const plan = [];
  if (reuse.key) plan.push({ via: 'key', key: reuse.key });
  if (reuse.id) plan.push({ via: 'id', id: reuse.id });
  return plan;
}
