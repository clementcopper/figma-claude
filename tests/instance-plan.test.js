import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInstancePlan, looksLikeNodeId, planFromNodeId } from '../src/lib/instance-plan.js';

test('key + id → key first (cross-file), id fallback (same-file)', () => {
  assert.deepEqual(resolveInstancePlan({ key: 'k', id: '1:2' }),
    [{ via: 'key', key: 'k' }, { via: 'id', id: '1:2' }]);
});
test('id only → id only', () => {
  assert.deepEqual(resolveInstancePlan({ id: '1:2' }), [{ via: 'id', id: '1:2' }]);
});
test('key only → key only', () => {
  assert.deepEqual(resolveInstancePlan({ key: 'k' }), [{ via: 'key', key: 'k' }]);
});
test('empty / null → empty plan', () => {
  assert.deepEqual(resolveInstancePlan(null), []);
  assert.deepEqual(resolveInstancePlan({}), []);
});

// Reported from the panel (FEEDBACK.md): no way to instance a component the session only had an
// id for, and no way to ask for twenty of them.
test('looksLikeNodeId accepts what Figma hands out', () => {
  assert.ok(looksLikeNodeId('15121:131077'));
  assert.ok(looksLikeNodeId('I2058:20351;2054:20325'), 'a nested instance id');
  assert.ok(looksLikeNodeId('  1:2  '), 'trimmed');
});

test('looksLikeNodeId rejects component names', () => {
  assert.ok(!looksLikeNodeId('Icon-Bulletpoint / Type=small'));
  assert.ok(!looksLikeNodeId('Button'));
  assert.ok(!looksLikeNodeId(''));
  assert.ok(!looksLikeNodeId(undefined));
  assert.ok(!looksLikeNodeId('H3'), 'a style tail is not an id');
});

test('planFromNodeId is the one-step plan, no key attempt', () => {
  assert.deepStrictEqual(planFromNodeId(' 15121:131077 '), [{ via: 'id', id: '15121:131077' }]);
});
