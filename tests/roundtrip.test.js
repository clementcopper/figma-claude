// Tests for the roundtrip proof (src/lib/roundtrip.js).
//
// The headline test runs the REAL DESIGN.md writer and the REAL importer parser
// against each other. Mocking either would prove nothing: the whole question is
// whether those two specific pieces of code still agree.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRoundtrip, compareTokenLayers, valueKey, formatRoundtripLoss } from '../src/lib/roundtrip.js';
import { generateDesignMd } from '../src/design-extract.js';

// A realistic two-layer token system: primitives + semantic aliasing into them,
// light/dark modes — the shape that actually breaks in practice.
const extraction = () => ({
  fileName: 'Roundtrip Fixture',
  date: '2026-07-29',
  pages: [{ id: '0:1', name: 'Components', nodeCount: 1, frames: [] }],
  variables: [
    {
      id: 'VC:1', name: 'primitives',
      modes: [{ id: 'm0', name: 'Value' }],
      variables: [
        { id: 'V:1', name: 'gray/0', type: 'COLOR', values: { Value: '#ffffff' } },
        { id: 'V:2', name: 'gray/9', type: 'COLOR', values: { Value: '#24292f' } },
        { id: 'V:3', name: 'space/2', type: 'FLOAT', values: { Value: 8 } },
      ],
    },
    {
      id: 'VC:2', name: 'semantic',
      modes: [{ id: 'm1', name: 'Light' }, { id: 'm2', name: 'Dark' }],
      variables: [
        { id: 'V:10', name: 'bg/default', type: 'COLOR', values: { Light: { alias: 'gray/0', aliasId: 'V:1' }, Dark: { alias: 'gray/9', aliasId: 'V:2' } } },
        { id: 'V:11', name: 'fg/default', type: 'COLOR', values: { Light: { alias: 'gray/9', aliasId: 'V:2' }, Dark: { alias: 'gray/0', aliasId: 'V:1' } } },
      ],
    },
  ],
});

describe('valueKey', () => {
  test('compares aliases by target and collection, not by object identity', () => {
    assert.equal(valueKey({ alias: 'gray/9', collection: 'primitives' }), '→gray/9@primitives');
    assert.equal(valueKey('#fff'), '#fff');
    assert.equal(valueKey(null), '∅');
  });
});

describe('verifyRoundtrip — against the real writer and real parser', () => {
  test('a full two-layer token system survives extract → DESIGN.md → import', () => {
    const r = verifyRoundtrip(extraction());
    assert.equal(r.ok, true, `losses: ${r.losses.map(formatRoundtripLoss).join(' | ')}`);
    assert.equal(r.skipped, false);
    assert.equal(r.varCount, 5);
    assert.equal(r.collections, 2);
  });

  test('alias chains survive per mode (light and dark must not collapse)', () => {
    // This is the failure that produces "everything is white": the light-mode
    // alias silently wins for both modes.
    const r = verifyRoundtrip(extraction());
    assert.deepEqual(r.losses, []);
  });

  test('skips cleanly when the file has no variables', () => {
    const r = verifyRoundtrip({ ...extraction(), variables: [] });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true);
    assert.match(r.reason, /no variables/);
  });

  test('FAILS when the writer drops a token (the proof actually proves something)', () => {
    // Guard against a vacuous pass: if the comparison could not detect a loss,
    // a green roundtrip would mean nothing.
    // Still the REAL generator — it is simply fed an extraction with one token
    // removed, which simulates a writer that fails to emit it.
    const lossyWrite = (ext, opts) => generateDesignMd({
      ...ext,
      variables: ext.variables.map(c => c.name === 'semantic'
        ? { ...c, variables: c.variables.filter(v => v.name !== 'fg/default') }
        : c),
    }, opts);
    const r = verifyRoundtrip(extraction(), { write: lossyWrite });
    assert.equal(r.ok, false);
    assert.ok(r.losses.some(l => l.kind === 'variable-missing' && l.variable === 'fg/default'),
      `expected the dropped token to be reported, got ${JSON.stringify(r.losses)}`);
  });
});

describe('compareTokenLayers', () => {
  const before = {
    semantic: { modes: ['Light', 'Dark'], variables: { 'bg/default': { type: 'COLOR', values: { Light: '#fff', Dark: '#000' } } } },
  };

  test('reports a whole collection that vanished', () => {
    const l = compareTokenLayers(before, {});
    assert.equal(l.length, 1);
    assert.equal(l[0].kind, 'collection-missing');
    assert.match(formatRoundtripLoss(l[0]), /semantic: collection did not survive/);
  });

  test('reports a lost mode', () => {
    const after = JSON.parse(JSON.stringify(before));
    after.semantic.modes = ['Light'];
    const l = compareTokenLayers(before, after);
    assert.ok(l.some(x => x.kind === 'modes-changed'));
  });

  test('reports a per-mode value change (the white-token bug)', () => {
    const after = JSON.parse(JSON.stringify(before));
    after.semantic.variables['bg/default'].values.Dark = '#ffffff';
    const l = compareTokenLayers(before, after);
    assert.equal(l.length, 1);
    assert.equal(l[0].kind, 'value-changed');
    assert.equal(l[0].mode, 'Dark');
    assert.match(formatRoundtripLoss(l[0]), /semantic › bg\/default › Dark: value changed \(#000 → #ffffff\)/);
  });

  test('reports a changed type', () => {
    const after = JSON.parse(JSON.stringify(before));
    after.semantic.variables['bg/default'].type = 'STRING';
    assert.ok(compareTokenLayers(before, after).some(x => x.kind === 'type-changed'));
  });

  test('an identical layer produces no losses', () => {
    assert.deepEqual(compareTokenLayers(before, JSON.parse(JSON.stringify(before))), []);
  });
});
