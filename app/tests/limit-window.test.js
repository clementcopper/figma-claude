import { describe, it } from 'node:test';
import assert from 'node:assert';
import { applyResetWindow } from '../dist/lib/limit-window.mjs';

const NOW = Date.parse('2026-08-21T12:00:00Z');
const at = (minutesFromNow) => (NOW + minutesFromNow * 60_000) / 1000;

describe('applyResetWindow', () => {
  it('recomputes the countdown from the absolute point', () => {
    const out = applyResetWindow({ sessionPercent: 84, sessionResetsAt: at(97) }, NOW);
    assert.strictEqual(out.sessionResetsInMin, 97);
    assert.strictEqual(out.sessionPercent, 84);
  });

  it('keeps the reset point after it passes, so the row can say "Limit reset"', () => {
    // The host used to delete this field, which would undo the panel's own fix: the row loses
    // its left half at the moment the waiting is over.
    const out = applyResetWindow({ sessionPercent: 100, sessionResetsAt: at(-5) }, NOW);
    assert.strictEqual(out.sessionResetsAt, at(-5));
    assert.strictEqual(out.sessionPercent, undefined, 'the old percentage says nothing about the new window');
    assert.strictEqual(out.sessionResetsInMin, undefined, 'a countdown to a past point is noise');
  });

  it('treats the boundary as passed', () => {
    const out = applyResetWindow({ sessionPercent: 99, sessionResetsAt: at(0) }, NOW);
    assert.strictEqual(out.sessionPercent, undefined);
    assert.ok(out.sessionResetsAt !== undefined);
  });

  it('drops a stale countdown when there is no point to measure from', () => {
    const out = applyResetWindow({ sessionResetsInMin: 42 }, NOW);
    assert.strictEqual(out.sessionResetsInMin, undefined);
  });

  it('does not mutate what it was given', () => {
    const input = { sessionPercent: 50, sessionResetsAt: at(-1) };
    applyResetWindow(input, NOW);
    assert.strictEqual(input.sessionPercent, 50);
  });
});
