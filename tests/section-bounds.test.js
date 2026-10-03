import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enclosingBox, relativeTo } from '../src/lib/section-bounds.js';

// FEEDBACK.md 2026-10-01: `section create` left a 496 × 496 section at the origin while its six
// children sat at x ≈ −31610, y ≈ 38519 — the box thousands of px from its content. These are
// the reporter's numbers.
const frames = [
  { x: -31610, y: 38519, width: 390, height: 844 },
  { x: -31170, y: 38519, width: 390, height: 844 },
  { x: -30730, y: 38519, width: 390, height: 844 },
  { x: -30290, y: 38519, width: 390, height: 844 },
  { x: -29850, y: 38519, width: 390, height: 844 },
  { x: -29410, y: 38519, width: 390, height: 1200 },
];

test('the section box is the min/max of the children plus padding on every side', () => {
  assert.deepEqual(enclosingBox(frames, 40), { x: -31650, y: 38479, width: 2670, height: 1280 });
});

test('a single tall frame gets the same treatment', () => {
  assert.deepEqual(enclosingBox([{ x: 100, y: 30, width: 390, height: 17050 }], 40), { x: 60, y: -10, width: 470, height: 17130 });
});

test('no boxes, no section box', () => {
  assert.equal(enclosingBox([], 40), null);
});

test('a child keeps its canvas position: relative = absolute minus the section origin', () => {
  const box = enclosingBox(frames, 40);
  assert.deepEqual(relativeTo(frames[0], box), { x: 40, y: 40 });
  assert.deepEqual(relativeTo(frames[5], box), { x: 2240, y: 40 });
});

test('both helpers embed: plain declarations, no outer references', () => {
  // The command pastes them into plugin code with .toString() (the text-styles convention).
  const src = enclosingBox.toString() + relativeTo.toString();
  assert.match(src, /^function enclosingBox\(/);
  assert.doesNotMatch(src, /\bimport\b|\brequire\b/);
});
