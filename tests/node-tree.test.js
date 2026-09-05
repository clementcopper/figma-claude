import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildNodeTree } from '../src/lib/node-tree.js';

// `node tree --json` was `{ lines: ["FRAME: Card (320x118) [1:2]", "  TEXT: …"] }` — text with
// indentation to parse. `docs scripting-the-cli` promises `--json` for anything read back, so
// the same walk also returns a nested tree. Plain function, embedded into plugin code via
// `.toString()` like `src/lib/text-styles.js`.

const n = (type, name, id, w, h, children) => ({ type, name, id, width: w, height: h, ...(children ? { children } : {}) });

describe('buildNodeTree', () => {
  it('nests id, name, type, size and children', () => {
    const root = n('FRAME', 'Card', '1:2', 320, 118, [n('TEXT', 'Title', '1:3', 270.4, 26)]);
    assert.deepStrictEqual(buildNodeTree(root, 3), {
      id: '1:2', name: 'Card', type: 'FRAME', w: 320, h: 118,
      children: [{ id: '1:3', name: 'Title', type: 'TEXT', w: 270, h: 26 }],
    });
  });
  it('stops at maxDepth and omits size where a node has none', () => {
    const deep = n('FRAME', 'A', '1', 10, 10, [n('FRAME', 'B', '2', 10, 10, [n('TEXT', 'C', '3', 10, 10)])]);
    const t = buildNodeTree(deep, 1);
    assert.deepStrictEqual(t.children[0].children, undefined);
    assert.deepStrictEqual(buildNodeTree({ type: 'PAGE', name: 'P', id: '0:1', children: [] }, 3), { id: '0:1', name: 'P', type: 'PAGE', children: [] });
  });
});
