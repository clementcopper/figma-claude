/**
 * The three lines every command needs that can place a node somewhere the user named.
 *
 * `render --parent` had them inline and was the only one of the three commands that did NOT
 * call `loadAllPagesAsync` first — so a parent id on a page Figma had not loaded answered
 * "Parent not found" for a node that plainly exists. `instantiate` and `duplicate` already
 * retried that way for their own lookups. One generator, one behaviour.
 *
 * A PAGE has `appendChild` too, so `--parent <pageId>` means "put it on that page" — which is
 * the short answer to the `--page` wish in FEEDBACK.md.
 */

/**
 * Resolve `parentId` into `varName` inside generated plugin code. Throws in the page when the
 * id names nothing or names something that cannot hold children.
 *
 * @param {string|undefined|null} parentId
 * @param {string} [varName]
 * @returns {string} plugin JS, or '' when no parent was asked for
 */
export function resolveParentCode(parentId, varName = '__p') {
  if (parentId === undefined || parentId === null || parentId === '') return '';
  const id = JSON.stringify(String(parentId));
  return `
let ${varName} = await figma.getNodeByIdAsync(${id});
// An id read off a live file may sit on a page this plugin has not loaded yet.
if (!${varName}) { await figma.loadAllPagesAsync(); ${varName} = await figma.getNodeByIdAsync(${id}); }
if (!${varName}) throw new Error('Parent not found: ' + ${id});
if (!('appendChild' in ${varName})) throw new Error('Parent cannot contain children: ' + ${varName}.type);
`;
}

/**
 * An expression for the PAGE a node ended up on — `null` for a node outside any page. Callers
 * want the node, not just its name: `figma.currentPage.selection` only accepts nodes of the
 * current page, so placing into another page must not try to select them. And the name gets
 * printed, because "it went somewhere else" is invisible otherwise — seven instances landed on
 * the page the user had last clicked and no output said so.
 *
 * @param {string} nodeExpr  plugin-side expression for the node
 * @returns {string} plugin JS expression
 */
export function pageOfCode(nodeExpr) {
  return `(() => { let __n = ${nodeExpr}; while (__n && __n.type !== 'PAGE') __n = __n.parent; return __n; })()`;
}
