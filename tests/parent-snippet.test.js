import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParentCode, pageOfCode } from '../src/lib/parent-snippet.js';

test('no parent asked for means no code at all', () => {
  for (const nothing of [undefined, null, '']) assert.equal(resolveParentCode(nothing), '');
});

test('the lookup retries after loadAllPagesAsync — the miss render had and the others did not', () => {
  const code = resolveParentCode('16572:401075');
  assert.match(code, /figma\.getNodeByIdAsync\("16572:401075"\)/);
  assert.match(code, /await figma\.loadAllPagesAsync\(\)/);
  // The retry must come after the first miss, not before: the walk is expensive on a big file.
  assert.ok(code.indexOf('getNodeByIdAsync') < code.indexOf('loadAllPagesAsync'));
  assert.match(code, /throw new Error\('Parent not found: '/);
  assert.match(code, /'appendChild' in __p/);
});

test('the id is quoted, never spliced', () => {
  // Every value inside generated plugin code goes through JSON.stringify.
  const code = resolveParentCode('a"); figma.root.remove(); //');
  assert.ok(!code.includes('a"); figma.root.remove()'), 'the raw string must not appear unquoted');
  assert.match(code, /"a\\"\);/);
});

test('the variable name is settable, for a generator that already uses __p', () => {
  assert.match(resolveParentCode('1:2', '__dest'), /let __dest = await figma\.getNodeByIdAsync/);
});

test('the page expression walks up to the PAGE node and answers null outside one', () => {
  const expr = pageOfCode('made[0]');
  assert.match(expr, /let __n = made\[0\]/);
  assert.match(expr, /__n\.type !== 'PAGE'/);
  // The node, not the name: the caller compares it with figma.currentPage before selecting.
  assert.match(expr, /return __n;/);
  // It is an expression, usable straight inside an object literal.
  assert.doesNotMatch(expr, /^\s*(let|const|return)\b/);
});
