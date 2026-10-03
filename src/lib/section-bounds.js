/**
 * Where a section goes when it is drawn around existing nodes.
 *
 * `section create` used to call `figma.createSection()` and `appendChild` the nodes — and
 * stop. The section kept Figma's default 496 × 496 at the origin while the children kept their
 * canvas positions, so the box sat thousands of px from its content (FEEDBACK.md, 2026-10-01:
 * children at x ≈ −31610 inside a section at 0/0). The Figma UI encloses a selection; so does
 * this: the min/max of the children's absolute boxes plus padding, and every child re-placed so
 * that its canvas position does not change.
 *
 * Both functions run in two worlds, like src/lib/text-styles.js: unit-tested here in Node and
 * pasted into the plugin code with `.toString()`. Hence plain declarations, no imports, no
 * closures, nothing beyond ES2017.
 */

/**
 * @param {{ x: number, y: number, width: number, height: number }[]} boxes absolute boxes
 * @param {number} padding on every side
 * @returns {{ x: number, y: number, width: number, height: number } | null} null when empty
 */
export function enclosingBox(boxes, padding) {
  if (!boxes || boxes.length === 0) return null;
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (var i = 0; i < boxes.length; i++) {
    var b = boxes[i];
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  return { x: minX - padding, y: minY - padding, width: maxX - minX + 2 * padding, height: maxY - minY + 2 * padding };
}

/** A child's position inside a container whose absolute origin is `origin`. */
export function relativeTo(box, origin) {
  return { x: box.x - origin.x, y: box.y - origin.y };
}
