// End-to-end tests for the `snapshot` / `check` commands that do NOT need a
// live Figma: the on-disk roundtrip and the guards that run before the CLI ever
// tries to connect. Those guards are the difference between a clear "regenerate
// this" and a confusing wall of phantom drift.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSnapshot, stableStringify, diffSnapshots, SNAPSHOT_VERSION } from '../src/lib/design-snapshot.js';

const CLI = resolve(import.meta.dirname, '../src/index.js');

/** Run the CLI, returning { status, out }. Never throws on a non-zero exit. */
function runCli(args, cwd) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, out };
  } catch (e) {
    return { status: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const fixture = () => ({
  fileName: 'Design System',
  date: '2026-07-29',
  pages: [{
    id: '0:1', name: 'Components', nodeCount: 3,
    frames: [{
      t: 'COMPONENT_SET', n: 'Button', id: '12:5', key: 'k',
      w: 300, h: 40, vp: { Size: ['sm'] }, kidCount: 1,
      kids: [{ t: 'COMPONENT', n: 'Size=sm', w: 80, h: 32, lm: 'HORIZONTAL', gap: 8, pad: [6, 12, 6, 12], fills: ['#0969da'] }],
    }],
  }],
  variables: [{
    id: 'VC:1', name: 'semantic', modes: [{ id: 'm', name: 'Light' }],
    variables: [{ id: 'V:1', name: 'bg/default', type: 'COLOR', values: { Light: '#ffffff' } }],
  }],
});

describe('snapshot file roundtrip through disk', () => {
  // JSON.stringify silently DROPS undefined values, so a snapshot that compares
  // equal in memory could still differ after a write/read cycle. The contract is
  // only worth anything if the written file is what gets compared.
  test('written then re-read compares equal to the in-memory snapshot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'figma-snap-'));
    const snap = buildSnapshot(fixture(), { scope: { pages: 'Components' } });
    const file = join(dir, 'design.json');
    writeFileSync(file, stableStringify(snap));
    const reread = JSON.parse(readFileSync(file, 'utf8'));
    const { equal, diffs } = diffSnapshots(snap, reread);
    assert.equal(equal, true, `disk roundtrip lost data: ${JSON.stringify(diffs)}`);
  });

  test('serialization is byte-stable across repeated builds', () => {
    const a = stableStringify(buildSnapshot(fixture()));
    const b = stableStringify(buildSnapshot(fixture()));
    assert.equal(a, b);
  });

  test('the written file is valid, pretty-printed JSON ending in a newline', () => {
    const text = stableStringify(buildSnapshot(fixture()));
    assert.doesNotThrow(() => JSON.parse(text));
    assert.ok(text.endsWith('}\n'));
    assert.ok(text.includes('\n  '), 'must be indented so git diffs are line-wise and reviewable');
  });
});

describe('check — guards that run before connecting to Figma', () => {
  test('missing contract exits 1 and points at `snapshot`', () => {
    const dir = mkdtempSync(join(tmpdir(), 'figma-snap-'));
    const { status, out } = runCli(['check'], dir);
    assert.equal(status, 1);
    assert.match(out, /No design\.json found/);
    assert.match(out, /figma-cli snapshot/);
  });

  test('unreadable contract exits 1 with the parse error, not a stack trace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'figma-snap-'));
    writeFileSync(join(dir, 'design.json'), '{ not json');
    const { status, out } = runCli(['check'], dir);
    assert.equal(status, 1);
    assert.match(out, /not readable JSON/);
  });

  test('a contract from an older format asks for a regenerate instead of faking drift', () => {
    const dir = mkdtempSync(join(tmpdir(), 'figma-snap-'));
    const old = buildSnapshot(fixture());
    old.version = SNAPSHOT_VERSION - 1;
    writeFileSync(join(dir, 'design.json'), stableStringify(old));
    const { status, out } = runCli(['check'], dir);
    assert.equal(status, 1);
    assert.match(out, new RegExp(`Snapshot format v${SNAPSHOT_VERSION - 1}`));
    assert.match(out, /Regenerate it/);
  });

  test('honours an explicit file argument', () => {
    const dir = mkdtempSync(join(tmpdir(), 'figma-snap-'));
    const { status, out } = runCli(['check', 'contract.json'], dir);
    assert.equal(status, 1);
    assert.match(out, /No contract\.json found/);
  });
});

describe('command registration', () => {
  test('snapshot and check are exposed with their scope flags', () => {
    const { out } = runCli(['snapshot', '--help'], process.cwd());
    for (const flag of ['--pages', '--selection', '--resolve-remote']) {
      assert.ok(out.includes(flag), `snapshot must expose ${flag}`);
    }
    const chk = runCli(['check', '--help'], process.cwd()).out;
    for (const flag of ['--pages', '--limit', '--json']) {
      assert.ok(chk.includes(flag), `check must expose ${flag}`);
    }
  });
});
