import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMeshFromColors } from '../src/gradient-extractor.js';

// `gradient mesh "red,blue"` produced a recipe full of #NANNANNAN and an opaque Figma error.
test('mesh: a colour that is not hex is refused by name', () => {
  assert.throws(() => buildMeshFromColors(['red', '#0000ff'], { seed: 1 }), /"red".*#rrggbb/);
});

test('mesh: 3- and 6-digit hex work, upper or lower case', () => {
  const r = buildMeshFromColors(['#F00', '#0000ff'], { seed: 1 });
  assert.equal(r.base.length, 7);
  assert.ok(r.blobs.every((b) => /^#[0-9A-F]{6}$/.test(b.color)));
});
