import { test, describe } from 'node:test';
import assert from 'node:assert';
import { planVariants, deriveBaseName } from '../src/lib/variant-plan.js';

const n = (id, name) => ({ id, name });

describe('planVariants — single axis (existing behaviour)', () => {
  test('renames to pure Property=Value', () => {
    const r = planVariants([n('1:2', 'Btn A'), n('1:3', 'Btn B')], {
      property: 'Size', values: ['Small', 'Large'], setName: 'Button',
    });
    assert.strictEqual(r.error, undefined);
    assert.deepStrictEqual(r.assignments, [
      { id: '1:2', name: 'Size=Small' },
      { id: '1:3', name: 'Size=Large' },
    ]);
    assert.deepStrictEqual(r.axes, { Size: ['Small', 'Large'] });
    assert.strictEqual(r.setName, 'Button');
  });

  test('derives the set name from the first node when --name is omitted', () => {
    const r = planVariants([n('1:2', 'Button, Size=Small'), n('1:3', 'Button, Size=Large')], {
      property: 'Size', values: ['Small', 'Large'],
    });
    assert.strictEqual(r.setName, 'Button');
  });

  test('rejects an id/value count mismatch', () => {
    const r = planVariants([n('1:2', 'a'), n('1:3', 'b')], { property: 'Size', values: ['Small'] });
    assert.match(r.error, /must equal --values count/);
  });

  test('rejects duplicate values', () => {
    const r = planVariants([n('1:2', 'a'), n('1:3', 'b')], { property: 'Size', values: ['S', 'S'] });
    assert.match(r.error, /Duplicate value/);
  });
});

describe('planVariants — multi axis', () => {
  const primer = [
    n('1:2', 'variant=primary, size=small, state=rest'),
    n('1:3', 'variant=primary, size=medium, state=rest'),
    n('1:4', 'variant=secondary, size=small, state=hover'),
  ];

  test('keeps the node names and reports every axis', () => {
    const r = planVariants(primer, { multi: true, setName: 'Button' });
    assert.strictEqual(r.error, undefined);
    assert.deepStrictEqual(r.assignments.map(a => a.name), primer.map(p => p.name));
    assert.deepStrictEqual(r.axes, {
      variant: ['primary', 'secondary'],
      size: ['small', 'medium'],
      state: ['rest', 'hover'],
    });
    assert.strictEqual(r.setName, 'Button');
  });

  test('tolerates whitespace and values containing "="', () => {
    const r = planVariants([
      n('1:2', 'state=rest,  size=small'),
      n('1:3', 'state=a=b, size=small'),
    ], { multi: true, setName: 'X' });
    assert.strictEqual(r.error, undefined);
    assert.deepStrictEqual(r.axes.state, ['rest', 'a=b']);
  });

  test('rejects names that are not prop=value', () => {
    const r = planVariants([n('1:2', 'Button Primary'), n('1:3', 'size=small')], { multi: true });
    assert.match(r.error, /prop=value/);
    assert.match(r.error, /Button Primary/);
  });

  test('rejects a mismatched axis set', () => {
    const r = planVariants([
      n('1:2', 'variant=primary, size=small'),
      n('1:3', 'variant=primary, state=rest'),
    ], { multi: true });
    assert.match(r.error, /same variant properties/);
  });

  test('rejects duplicate combinations', () => {
    const r = planVariants([
      n('1:2', 'variant=primary, size=small'),
      n('1:3', 'size=small, variant=primary'),
    ], { multi: true });
    assert.match(r.error, /Duplicate variant combination/);
  });

  test('defaults the set name to Component', () => {
    const r = planVariants([n('1:2', 'size=small'), n('1:3', 'size=large')], { multi: true });
    assert.strictEqual(r.setName, 'Component');
  });

  test('scales to a full 144-variant matrix', () => {
    const nodes = [];
    let i = 0;
    for (const variant of ['primary', 'secondary', 'danger', 'invisible'])
      for (const size of ['small', 'medium', 'large'])
        for (const state of ['rest', 'focus', 'hover', 'pressed', 'disabled', 'inactive'])
          for (const align of ['center', 'start'])
            nodes.push(n(`1:${i++}`, `variant=${variant}, size=${size}, state=${state}, alignContent=${align}`));
    assert.strictEqual(nodes.length, 144);
    const r = planVariants(nodes, { multi: true, setName: 'Button' });
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(r.assignments.length, 144);
    assert.deepStrictEqual(Object.keys(r.axes), ['variant', 'size', 'state', 'alignContent']);
    assert.strictEqual(r.axes.state.length, 6);
  });
});

describe('planVariants — guards', () => {
  test('rejects fewer than 2 nodes', () => {
    const r = planVariants([n('1:2', 'size=small')], { multi: true });
    assert.match(r.error, /at least 2 nodes/);
  });

  test('rejects --multi combined with --property', () => {
    const r = planVariants([n('1:2', 'a=b'), n('1:3', 'a=c')], { multi: true, property: 'Size', values: ['S', 'L'] });
    assert.match(r.error, /do not combine/);
  });

  test('rejects a missing --property in single-axis mode', () => {
    const r = planVariants([n('1:2', 'a'), n('1:3', 'b')], { values: ['S', 'L'] });
    assert.match(r.error, /Need --property/);
  });

  test('rejects the same id twice', () => {
    const r = planVariants([n('1:2', 'a=b'), n('1:2', 'a=c')], { multi: true });
    assert.match(r.error, /passed twice/);
  });
});

describe('deriveBaseName', () => {
  test('strips variant suffixes and slash paths', () => {
    assert.strictEqual(deriveBaseName('Button, Size=Small'), 'Button');
    assert.strictEqual(deriveBaseName('Button/primary/small'), 'Button');
    assert.strictEqual(deriveBaseName('Card'), 'Card');
    assert.strictEqual(deriveBaseName(''), 'Component');
  });
});
