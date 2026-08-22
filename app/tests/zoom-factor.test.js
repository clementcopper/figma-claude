import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveZoomFactor } from '../dist/lib/zoom-factor.mjs';

describe('resolveZoomFactor', () => {
  it('passes a sane factor through', () => {
    assert.strictEqual(resolveZoomFactor(1.2), 1.2);
    assert.strictEqual(resolveZoomFactor(0.75), 0.75);
  });

  it('defaults to 1 when the key is absent', () => {
    assert.strictEqual(resolveZoomFactor(undefined), 1);
  });

  it('treats a value that is not a number as absent', () => {
    // panel.json is hand-edited, so "1.2" is a likelier mistake than 1.2
    assert.strictEqual(resolveZoomFactor('1.2'), 1);
    assert.strictEqual(resolveZoomFactor(null), 1);
    assert.strictEqual(resolveZoomFactor({}), 1);
    assert.strictEqual(resolveZoomFactor(true), 1);
  });

  it('refuses zero and negative factors, which would make the window unusable', () => {
    assert.strictEqual(resolveZoomFactor(0), 1);
    assert.strictEqual(resolveZoomFactor(-2), 1);
  });

  it('refuses NaN and Infinity', () => {
    assert.strictEqual(resolveZoomFactor(NaN), 1);
    assert.strictEqual(resolveZoomFactor(Infinity), 1);
  });

  it('clamps at both ends rather than obeying', () => {
    assert.strictEqual(resolveZoomFactor(0.1), 0.5, 'illegible below this');
    assert.strictEqual(resolveZoomFactor(40), 3, 'a 320 px window would hold nothing');
  });
});
