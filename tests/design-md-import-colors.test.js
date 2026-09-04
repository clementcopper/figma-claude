import { test } from 'node:test';
import assert from 'node:assert/strict';
import { variableImportCode } from '../src/design-md.js';

// A hand-written DESIGN.md with `#fff` or `rgb(…)` created the variable and set no value —
// no message, a black swatch. Run the generated plugin code against a minimal fake `figma`.

function fakeFigma() {
  const vars = [];
  const cols = [];
  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => cols,
      getLocalVariablesAsync: async () => vars,
      createVariableCollection: (name) => { const c = { id: 'c' + cols.length, name, variableIds: [], modes: [{ modeId: 'm1', name: 'Mode 1' }], renameMode(id, n) { this.modes[0].name = n; }, addMode(n) { const id = 'm' + (this.modes.length + 1); this.modes.push({ modeId: id, name: n }); return id; } }; cols.push(c); return c; },
      createVariable: (name, col, type) => { const v = { id: 'v' + vars.length, name, variableCollectionId: col.id, resolvedType: type, values: {}, setValueForMode(m, val) { this.values[m] = val; } }; vars.push(v); col.variableIds.push(v.id); return v; },
    },
    _vars: vars,
  };
}

test('import: #rgb is expanded, an unparseable colour is counted and named', async () => {
  const code = variableImportCode({ Coll: { modes: ['Light'], variables: {
    'c/short': { type: 'COLOR', values: { Light: '#fff' } },
    'c/bad': { type: 'COLOR', values: { Light: 'red' } },
    'c/ok': { type: 'COLOR', values: { Light: '#3b82f6' } },
  } } });
  const figma = fakeFigma();
  const result = JSON.parse(await new Function('figma', 'return ' + code)(figma));
  const byName = Object.fromEntries(figma._vars.map((v) => [v.name, v.values.m1]));
  assert.deepEqual(byName['c/short'], { r: 1, g: 1, b: 1, a: 1 });
  assert.equal(byName['c/bad'], undefined);
  assert.equal(result.skippedColors, 1);
  assert.deepEqual(result.skipped, ['c/bad: red']);
});
