import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportSizeLabel } from '../src/lib/export-line.js';

test('a node with a size gets " (WxH)"', () => {
  assert.equal(exportSizeLabel({ width: 5000, height: 5980 }), ' (5000x5980)');
  assert.equal(exportSizeLabel({ width: 199.6, height: 40.2 }), ' (200x40)');
});

test('a page — no width, no height — gets no size, not "(nullxnull)"', () => {
  assert.equal(exportSizeLabel({ width: null, height: null }), '');
  assert.equal(exportSizeLabel({}), '');
  assert.equal(exportSizeLabel({ width: NaN, height: NaN }), '');
  assert.equal(exportSizeLabel(null), '');
});
