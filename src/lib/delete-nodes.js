/**
 * Deleting nodes: one decision, one plugin-code builder, one report — for `delete`,
 * `delete-batch` and `node delete`, which had three behaviours (a silent full-selection
 * delete with exit 0 among them).
 */

/**
 * @returns {{ ids: string[] } | { selection: true } | { refuse: string }}
 */
export function deletePlan({ ids = [], selectionCount = 0, yes = false }) {
  if (ids.length) return { ids };
  if (selectionCount === 0) return { refuse: 'Nothing selected and no id given' };
  if (selectionCount > 1 && !yes) {
    return { refuse: `${selectionCount} nodes are selected — pass --yes to delete them all, or name the ids` };
  }
  return { selection: true };
}

/** Plugin code: delete by ids, or (ids null) the current selection. Returns { deleted, missing }. */
export function deleteNodesCode(ids) {
  return `(async () => {
  const deleted = [], missing = [];
  ${ids
    ? `for (const id of ${JSON.stringify(ids)}) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) { missing.push(id); continue; }
    deleted.push({ id, name: node.name });
    node.remove();
  }`
    : `for (const node of [...figma.currentPage.selection]) {
    deleted.push({ id: node.id, name: node.name });
    node.remove();
  }`}
  return { deleted, missing };
})()`;
}

/** Lines to print and the exit code: a missing id is a failure, not a silent success. */
export function formatDeleteResult(result) {
  const deleted = result?.deleted || [];
  const missing = result?.missing || [];
  const lines = [
    ...deleted.map((d) => `✓ Deleted ${d.id} ("${d.name}")`),
    ...missing.map((id) => `○ Not found: ${id}`),
  ];
  if (!deleted.length && !missing.length) lines.push('Nothing deleted');
  return { lines, exitCode: missing.length ? 1 : 0 };
}
