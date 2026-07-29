// Tests for the canonical snapshot + differ (src/lib/design-snapshot.js).
//
// The whole point of the module is that validation stops depending on a human
// (or a model) eyeballing prose, so these tests are written as the CONTRACT:
// what must compare equal, what must compare different, and why.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SNAPSHOT_VERSION, normalizeNode, normalizePage, normalizeVariables,
  buildSnapshot, stableStringify, diffSnapshots, formatDiff, summarizeDiff,
  normalizeScope, sameScope,
} from '../src/lib/design-snapshot.js';

describe('scope', () => {
  test('treats an equivalent scope written differently as the same', () => {
    assert.equal(sameScope({ pages: 'A,B' }, { pages: ['b', ' a '] }), true);
  });

  test('treats a narrower scope as different (it would fake drift)', () => {
    assert.equal(sameScope({ pages: 'A,B' }, { pages: 'A' }), false);
    assert.equal(sameScope(null, { pages: 'A' }), false);
  });

  test('normalizes missing fields to a stable shape', () => {
    assert.deepEqual(normalizeScope({}), { pages: null, sections: null, selection: false, resolveRemote: false });
  });
});

// A minimal but realistic walker payload: a component set whose default variant
// carries a node id + publish key (both volatile), nested children, floats.
const buttonSet = () => ({
  t: 'COMPONENT_SET', n: 'Button', id: '12:5', key: 'abc123',
  w: 300, h: 40, vp: { Size: ['sm', 'md'] }, kidCount: 2,
  kids: [{
    t: 'COMPONENT', n: 'Size=sm', w: 80, h: 32, lm: 'HORIZONTAL',
    gap: 8.000000001, pad: [6, 12, 6, 12], fills: ['#0969da'],
    kids: [
      { t: 'TEXT', n: 'Label', w: 40, h: 20, txt: { chars: 'Save', size: 14 } },
      { t: 'INSTANCE', n: 'Icon', w: 16, h: 16, mc: 'Icon' },
    ],
  }],
});

describe('normalizeNode', () => {
  test('drops volatile node id and publish key at every depth', () => {
    const n = normalizeNode({ t: 'FRAME', n: 'Root', id: '1:1', key: 'k', kids: [{ t: 'COMPONENT_SET', n: 'Inner', id: '2:2', key: 'k2' }] });
    assert.equal(n.id, undefined);
    assert.equal(n.key, undefined);
    assert.equal(n.kids[0].id, undefined);
    assert.equal(n.kids[0].key, undefined);
    assert.equal(n.n, 'Root', 'keeps the name');
  });

  test('rounds float noise so a renderer artifact cannot diff', () => {
    const n = normalizeNode({ t: 'FRAME', n: 'X', gap: 8.000000001, pad: [0.30000000000000004, 0, 0, 0] });
    assert.equal(n.gap, 8);
    assert.equal(n.pad[0], 0.3);
  });

  test('preserves child ORDER (order is the design in an auto-layout row)', () => {
    const n = normalizeNode({ t: 'FRAME', n: 'Row', lm: 'HORIZONTAL', kids: [{ t: 'TEXT', n: 'B' }, { t: 'TEXT', n: 'A' }] });
    assert.deepEqual(n.kids.map(k => k.n), ['B', 'A']);
  });

  test('is stable regardless of the key insertion order of the input', () => {
    const a = normalizeNode({ n: 'X', t: 'FRAME', w: 10, h: 20 });
    const b = normalizeNode({ h: 20, w: 10, t: 'FRAME', n: 'X' });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });
});

describe('normalizePage', () => {
  test('sorts top-level frames by name (canvas z-order is not design intent)', () => {
    const p = normalizePage({ id: '0:1', name: 'Components', nodeCount: 5, frames: [{ t: 'FRAME', n: 'Card' }, { t: 'FRAME', n: 'Badge' }] });
    assert.deepEqual(p.frames.map(f => f.n), ['Badge', 'Card']);
    assert.equal(p.id, undefined, 'page id is volatile and must be dropped');
  });

  test('keeps incompleteness visible — a truncated page must not look clean', () => {
    const p = normalizePage({ name: 'Huge', nodeCount: 0, frames: [], reducedDepth: 4, error: 'payload too large' });
    assert.equal(p.reducedDepth, 4);
    assert.equal(p.error, 'payload too large');
  });
});

describe('normalizeVariables', () => {
  const collections = () => ([{
    id: 'VC:2', name: 'semantic',
    modes: [{ id: 'm1', name: 'Light' }, { id: 'm2', name: 'Dark' }],
    variables: [
      { id: 'V:9', name: 'fg/default', type: 'COLOR', values: { Light: { alias: 'gray/9', aliasId: 'V:1' }, Dark: '#ffffff' } },
      { id: 'V:8', name: 'bg/default', type: 'COLOR', values: { Light: '#ffffff', Dark: '#0d1117' } },
    ],
  }, {
    id: 'VC:1', name: 'primitives',
    modes: [{ id: 'm0', name: 'Value' }],
    variables: [{ id: 'V:1', name: 'gray/9', type: 'COLOR', values: { Value: '#24292f' } }],
  }]);

  test('sorts collections and variables (both are unordered sets in Figma)', () => {
    const v = normalizeVariables(collections());
    assert.deepEqual(v.map(c => c.name), ['primitives', 'semantic']);
    assert.deepEqual(v[1].variables.map(x => x.name), ['bg/default', 'fg/default']);
  });

  test('resolves aliases to (name, collection) and drops the volatile alias id', () => {
    const v = normalizeVariables(collections());
    const fg = v.find(c => c.name === 'semantic').variables.find(x => x.name === 'fg/default');
    assert.deepEqual(fg.values.Light, { alias: 'gray/9', collection: 'primitives' });
    assert.equal('aliasId' in fg.values.Light, false, 'alias id changes per file and must not diff');
  });
});

describe('buildSnapshot', () => {
  const extraction = (over = {}) => ({
    fileName: 'Design System',
    date: '2026-07-29',
    pages: [{ id: '0:1', name: 'Components', nodeCount: 4, frames: [buttonSet()] }],
    variables: [],
    ...over,
  });

  test('carries a version so a shape change can invalidate old snapshots', () => {
    assert.equal(buildSnapshot(extraction()).version, SNAPSHOT_VERSION);
  });

  test('keeps provenance in meta but out of the design contract', () => {
    const s = buildSnapshot(extraction());
    assert.equal(s.meta.file, 'Design System');
    assert.equal(s.meta.extractedAt, '2026-07-29');
  });

  test('records the scope it was taken with, normalized', () => {
    const s = buildSnapshot(extraction(), { scope: { pages: 'Components, Archive', selection: false, resolveRemote: true } });
    assert.deepEqual(s.meta.scope, { pages: ['archive', 'components'], sections: null, selection: false, resolveRemote: true });
  });

  test('scope is null when the whole file was captured', () => {
    assert.equal(buildSnapshot(extraction()).meta.scope, null);
  });

  test('tolerates an empty extraction instead of throwing', () => {
    const s = buildSnapshot({});
    assert.deepEqual(s.pages, []);
    assert.deepEqual(s.variables, []);
  });
});

describe('stableStringify', () => {
  test('serializes structurally equal objects to identical bytes', () => {
    const a = stableStringify({ b: 1, a: { d: 2, c: 3 } });
    const b = stableStringify({ a: { c: 3, d: 2 }, b: 1 });
    assert.equal(a, b);
  });

  test('does NOT reorder arrays (child order is meaningful)', () => {
    assert.match(stableStringify({ k: ['b', 'a'] }), /"b",\s*"a"/);
  });

  test('ends with a newline so the file is git/diff friendly', () => {
    assert.ok(stableStringify({ a: 1 }).endsWith('\n'));
  });
});

describe('diffSnapshots — the roundtrip guarantee', () => {
  // This is concern #1 in executable form: the SAME design system re-imported
  // gets brand-new node ids, a new file name and a new extraction date. If any
  // of that leaked into the canonical form, a lossless roundtrip would report
  // false drift and the contract would be worthless.
  test('a lossless roundtrip compares EQUAL despite new ids, file and date', () => {
    const before = buildSnapshot({
      fileName: 'Source', date: '2026-01-01',
      pages: [{ id: '0:1', name: 'Components', nodeCount: 4, frames: [buttonSet()] }],
      variables: [],
    });
    const reimported = buildSnapshot({
      fileName: 'Copy of Source', date: '2026-07-29',
      pages: [{ id: '99:7', name: 'Components', nodeCount: 4, frames: [{ ...buttonSet(), id: '77:1', key: 'zzz' }] }],
      variables: [],
    });
    const { equal, diffs } = diffSnapshots(before, reimported);
    assert.equal(equal, true, `expected equal, got: ${diffs.map(formatDiff).join(' | ')}`);
  });

  test('catches a LOSSY roundtrip and names the exact path', () => {
    const before = buildSnapshot({ pages: [{ name: 'Components', nodeCount: 4, frames: [buttonSet()] }] });
    const broken = JSON.parse(JSON.stringify(before));
    broken.pages[0].frames[0].kids[0].h = 56;    // height inflated on re-import
    const { equal, diffs } = diffSnapshots(before, broken);
    assert.equal(equal, false);
    assert.equal(diffs.length, 1, 'one change must report exactly one diff');
    assert.match(diffs[0].path, /Button\/kids\/Size=sm\/h$/);
    assert.equal(diffs[0].base, 32);   // the sm variant, not the set (h 40)
    assert.equal(diffs[0].next, 56);
  });

  test('catches the "tokens re-import white" class of bug', () => {
    const cols = [{
      id: 'VC:1', name: 'semantic', modes: [{ id: 'm', name: 'Light' }],
      variables: [{ id: 'V:1', name: 'bg/default', type: 'COLOR', values: { Light: '#0969da' } }],
    }];
    const before = buildSnapshot({ variables: cols });
    const white = buildSnapshot({
      variables: [{ ...cols[0], variables: [{ ...cols[0].variables[0], values: { Light: '#ffffff' } }] }],
    });
    const { equal, diffs } = diffSnapshots(before, white);
    assert.equal(equal, false);
    assert.match(formatDiff(diffs[0]), /bg\/default.*#0969da → #ffffff/);
  });
});

describe('diffSnapshots — drift reporting quality', () => {
  test('an inserted child reports ONE addition, not a cascade of shifted siblings', () => {
    const base = buildSnapshot({ pages: [{ name: 'P', nodeCount: 3, frames: [{ t: 'FRAME', n: 'Row', lm: 'HORIZONTAL', kids: [{ t: 'TEXT', n: 'A' }, { t: 'TEXT', n: 'B' }] }] }] });
    const next = buildSnapshot({ pages: [{ name: 'P', nodeCount: 4, frames: [{ t: 'FRAME', n: 'Row', lm: 'HORIZONTAL', kids: [{ t: 'TEXT', n: 'A' }, { t: 'TEXT', n: 'NEW' }, { t: 'TEXT', n: 'B' }] }] }] });
    const { diffs } = diffSnapshots(base, next);
    const added = diffs.filter(d => d.kind === 'added' && /NEW/.test(d.path));
    assert.equal(added.length, 1);
    // nodeCount also changed; the point is B was NOT reported as rewritten.
    assert.equal(diffs.some(d => /\/B\//.test(d.path)), false);
  });

  test('reports a removed page', () => {
    const base = buildSnapshot({ pages: [{ name: 'A', nodeCount: 1, frames: [] }, { name: 'B', nodeCount: 1, frames: [] }] });
    const next = buildSnapshot({ pages: [{ name: 'A', nodeCount: 1, frames: [] }] });
    const { diffs } = diffSnapshots(base, next);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].kind, 'removed');
    assert.match(diffs[0].path, /pages\/B$/);
  });

  test('meta is provenance, not design — it never counts as drift', () => {
    const a = buildSnapshot({ fileName: 'X', date: '2026-01-01', pages: [] });
    const b = buildSnapshot({ fileName: 'Y', date: '2026-12-31', pages: [] });
    assert.equal(diffSnapshots(a, b).equal, true);
  });

  test('caps the report so a wholesale change cannot print thousands of lines', () => {
    const many = (n, tag) => ({ pages: [{ name: 'P', nodeCount: n, frames: Array.from({ length: n }, (_, i) => ({ t: 'FRAME', n: `F${i}`, w: tag })) }] });
    const { diffs, truncated } = diffSnapshots(buildSnapshot(many(50, 1)), buildSnapshot(many(50, 2)), { limit: 10 });
    assert.equal(diffs.length, 10);
    assert.equal(truncated, true);
  });

  test('summarizeDiff groups by area for a one-line verdict', () => {
    const diffs = [{ path: '/pages/A/h' }, { path: '/pages/B/w' }, { path: '/variables/semantic/x' }];
    assert.deepEqual(summarizeDiff(diffs), { pages: 2, variables: 1 });
  });

  test('formatDiff renders each kind readably', () => {
    assert.equal(formatDiff({ path: '/a/b', kind: 'changed', base: 1, next: 2 }), '~ a/b: 1 → 2');
    assert.equal(formatDiff({ path: '/a/b', kind: 'added', next: 2 }), '+ a/b: 2');
    assert.equal(formatDiff({ path: '/a/b', kind: 'removed', base: 1 }), '- a/b: 1');
  });
});
