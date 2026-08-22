import { describe, it } from 'node:test';
import assert from 'node:assert';
import { planLimitsBroadcast } from '../dist/lib/limit-broadcast.mjs';

const NOW = Date.parse('2026-08-22T12:00:00Z');
const at = (minutesFromNow) => (NOW + minutesFromNow * 60_000) / 1000;
const secs = (ms) => ms / 1000;

/** A tab snapshot as the watcher holds it, trimmed to what the decision reads. */
const tab = (updatedAtMs, extra = {}) => ({
  model: 'Opus 5',
  updatedAt: secs(updatedAtMs),
  sessionPercent: 40,
  sessionResetsAt: at(90),
  sessionResetsInMin: 90,
  ...extra
});

const limits = (updatedAtMs, extra = {}) => ({
  sessionPercent: 73,
  sessionResetsAt: at(70),
  sessionResetsInMin: 70,
  weekPercent: 12,
  weekResetsAt: 'Mon 9am',
  updatedAt: secs(updatedAtMs),
  ...extra
});

describe('planLimitsBroadcast', () => {
  it('replaces the percentage of a tab that has not rendered since', () => {
    const plan = planLimitsBroadcast(
      limits(NOW),
      undefined,
      [['tab-1', tab(NOW - 20 * 60_000)]],
      NOW
    );

    assert.ok(plan);
    assert.strictEqual(plan.updates.length, 1);
    const [id, merged] = plan.updates[0];
    assert.strictEqual(id, 'tab-1');
    assert.strictEqual(merged.sessionPercent, 73, 'the newer number wins');
    assert.strictEqual(merged.weekPercent, 12);
    assert.strictEqual(merged.weekResetsAt, 'Mon 9am');
  });

  it('leaves the tab\'s own updatedAt alone', () => {
    // It drives the stale dimming, and model and context really are old — only the limits row,
    // which the dimming exempts, gets the fresh numbers.
    const own = secs(NOW - 20 * 60_000);
    const plan = planLimitsBroadcast(limits(NOW), undefined, [['tab-1', tab(NOW - 20 * 60_000)]], NOW);

    assert.strictEqual(plan.updates[0][1].updatedAt, own);
  });

  it('carries the rest of the snapshot over untouched', () => {
    const plan = planLimitsBroadcast(
      limits(NOW),
      undefined,
      [['tab-1', tab(NOW - 60_000, { model: 'Sonnet 5', usedPercent: 31 })]],
      NOW
    );

    assert.strictEqual(plan.updates[0][1].model, 'Sonnet 5');
    assert.strictEqual(plan.updates[0][1].usedPercent, 31);
  });

  it('says nothing when the file has not changed since the last broadcast', () => {
    const file = limits(NOW);
    assert.strictEqual(
      planLimitsBroadcast(file, file.updatedAt, [['tab-1', tab(NOW - 60_000)]], NOW),
      null,
      'an unchanged rewrite must not produce a second callback'
    );
  });

  it('ignores a file older than the tab\'s own snapshot', () => {
    const plan = planLimitsBroadcast(limits(NOW - 10 * 60_000), undefined, [['tab-1', tab(NOW)]], NOW);

    assert.ok(plan, 'the file was still read, so its timestamp is remembered');
    assert.deepStrictEqual(plan.updates, [], 'a tab that rendered later knows better');
  });

  it('remembers the timestamp even when no tab needs the update', () => {
    // Otherwise the same file is re-examined on every watch event and every poll.
    const plan = planLimitsBroadcast(limits(NOW), undefined, [], NOW);
    assert.strictEqual(plan.limitsAt, secs(NOW));
    assert.deepStrictEqual(plan.updates, []);
  });

  it('drops a percentage whose window has already reset', () => {
    const plan = planLimitsBroadcast(
      limits(NOW, { sessionResetsAt: at(-5), sessionResetsInMin: 5 }),
      undefined,
      [['tab-1', tab(NOW - 60_000)]],
      NOW
    );

    const merged = plan.updates[0][1];
    assert.strictEqual(merged.sessionPercent, undefined);
    assert.strictEqual(merged.sessionResetsInMin, undefined);
    assert.strictEqual(merged.sessionResetsAt, at(-5), 'the row still says "Limit reset"');
  });

  it('recomputes the countdown from the absolute point', () => {
    const plan = planLimitsBroadcast(
      limits(NOW, { sessionResetsInMin: 999 }),
      undefined,
      [['tab-1', tab(NOW - 60_000)]],
      NOW
    );

    assert.strictEqual(plan.updates[0][1].sessionResetsInMin, 70, 'not the stale 999');
  });

  it('says nothing about an unreadable or timestampless file', () => {
    assert.strictEqual(planLimitsBroadcast(undefined, undefined, [['t', tab(NOW)]], NOW), null);
    assert.strictEqual(
      planLimitsBroadcast({ sessionPercent: 73 }, undefined, [['t', tab(NOW)]], NOW),
      null,
      'without updatedAt there is no way to tell whether it is newer'
    );
  });

  it('updates every tab that predates the file, and only those', () => {
    const plan = planLimitsBroadcast(
      limits(NOW),
      undefined,
      [
        ['old-1', tab(NOW - 30 * 60_000)],
        ['fresh', tab(NOW + 60_000)],
        ['old-2', tab(NOW - 60_000)]
      ],
      NOW
    );

    assert.deepStrictEqual(
      plan.updates.map(([id]) => id),
      ['old-1', 'old-2']
    );
  });
});
