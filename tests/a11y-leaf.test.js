import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// `a11y text <TEXT-id>` printed "✓ Pass: 0/0": the walk started with `if ('children' in root)`
// and a leaf node has none, so it was never examined. `contrast` had the `else traverse(root)`;
// touch, text, focus and audit did not.

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'commands', 'a11y.js'), 'utf8');

describe('a11y root traversal', () => {
  it('examines a leaf node that is passed by id', () => {
    const re = /if \('children' in root\) \{\n\s*for \(const child of root\.children\) traverse\(child\);\n\s*\}(?! else)/g;
    const bare = [];
    let m;
    while ((m = re.exec(src)) !== null) bare.push(src.slice(0, m.index).split('\n').length);
    assert.deepStrictEqual(bare, [], `line(s) without an else-branch for a leaf root: ${bare.join(', ')}`);
  });
});
