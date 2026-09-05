/**
 * The nested form of `node tree`: { id, name, type, w, h, children } down to maxDepth.
 * Sizes rounded like the text lines; a node without width (page, group of nothing) has no
 * w/h; a node past maxDepth contributes no `children`.
 *
 * Plain function, no imports, no closures: it is embedded into plugin code as source via
 * `.toString()` (the `src/lib/text-styles.js` pattern) and unit-tested here.
 */
export function buildNodeTree(node, maxDepth, depth) {
  var d = depth || 0;
  var out = { id: node.id, name: node.name, type: node.type };
  if (node.width && node.height) { out.w = Math.round(node.width); out.h = Math.round(node.height); }
  if ('children' in node && d < maxDepth) {
    out.children = [];
    for (var i = 0; i < node.children.length; i++) out.children.push(buildNodeTree(node.children[i], maxDepth, d + 1));
  }
  return out;
}
