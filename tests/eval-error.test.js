import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relocateFrames, lineOffsetFor } from '../src/lib/eval-error.js';

// The stack the daemon logged on 2026-10-03 for a five-line run script whose helper threw on
// line 3; the wrapper (src/lib/eval-wrap.js) adds one line above the user's code.
const stack = [
  '    at get_visible (<anonymous>:4:17)',
  '    at <anonymous>:6:8',
  '    at <anonymous>:8:3',
];

test('frames are mapped onto the submitted file and the wrapper frame is dropped', () => {
  assert.deepEqual(relocateFrames(stack, { file: 'throws.js', lineOffset: 1, lineCount: 5 }), [
    '    at get_visible (throws.js:3:17)',
    '    at throws.js:5:8',
  ]);
});

test('an IIFE the user wrote is sent unwrapped: offset 0', () => {
  assert.equal(lineOffsetFor('(async () => { return 1 })()'), 0);
  assert.equal(lineOffsetFor('return 1'), 1);
  assert.equal(lineOffsetFor('figma.root.name'), 1);
});

test('lines that are not frames pass through', () => {
  assert.deepEqual(relocateFrames(['  caused by x'], { file: 'f.js', lineOffset: 1, lineCount: 9 }), ['  caused by x']);
});
