// Chunked variable import.
//
// The importer inlines the whole token block into ONE eval. Once an export
// carries a captured library (semantic + primitives) that payload exceeds the
// daemon limit and the import dies with a bare "fetch failed" — so the block is
// split, and the two-pass contract (create everything, then wire aliases) is
// upheld by the CALLER running all create-chunks first.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { chunkVariableTokens, variableImportCode } from '../src/design-md.js';

const block = (n, collName = 'mode') => ({
  [collName]: {
    modes: ['light', 'dark'],
    variables: Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`v${i}`, { type: 'COLOR', values: { light: '#000000', dark: '#ffffff' } }])
    ),
  },
});

describe('chunkVariableTokens', () => {
  test('splits one big collection into bounded chunks', () => {
    const chunks = chunkVariableTokens(block(450), 200);
    assert.strictEqual(chunks.length, 3);
    const counts = chunks.map(c => Object.keys(c.mode.variables).length);
    assert.deepStrictEqual(counts, [200, 200, 50]);
  });

  test('every chunk keeps its collection modes', () => {
    for (const c of chunkVariableTokens(block(300), 100)) {
      assert.deepStrictEqual(c.mode.modes, ['light', 'dark']);
    }
  });

  test('loses no variable and keeps every definition intact', () => {
    const src = { ...block(120), ...block(80, 'base/color') };
    const chunks = chunkVariableTokens(src, 50);
    const seen = new Set();
    for (const c of chunks)
      for (const [coll, def] of Object.entries(c))
        for (const name of Object.keys(def.variables)) seen.add(`${coll}/${name}`);
    assert.strictEqual(seen.size, 200);
    assert.deepStrictEqual(chunks[0].mode.variables.v0, { type: 'COLOR', values: { light: '#000000', dark: '#ffffff' } });
  });

  test('a chunk may span two collections without mixing their modes', () => {
    const src = {
      a: { modes: ['m1'], variables: { x: { type: 'COLOR', values: { m1: '#111111' } } } },
      b: { modes: ['q1', 'q2'], variables: { y: { type: 'COLOR', values: { q1: '#222222' } } } },
    };
    const [chunk] = chunkVariableTokens(src, 200);
    assert.deepStrictEqual(chunk.a.modes, ['m1']);
    assert.deepStrictEqual(chunk.b.modes, ['q1', 'q2']);
  });

  test('keeps collections that have no variables (the collection still matters)', () => {
    const chunks = chunkVariableTokens({ empty: { modes: ['default'], variables: {} } }, 200);
    assert.strictEqual(chunks.length, 1);
    assert.deepStrictEqual(chunks[0].empty.variables, {});
  });

  test('empty input yields no chunks', () => {
    assert.deepStrictEqual(chunkVariableTokens({}, 200), []);
  });
});

describe('variableImportCode passes', () => {
  const vars = {
    mode: {
      modes: ['light'],
      variables: {
        a: { type: 'COLOR', values: { light: '#1f883d' } },
        b: { type: 'COLOR', values: { light: { alias: 'a', collection: 'mode' } } },
      },
    },
  };

  test('defaults to both passes (unchanged behaviour)', () => {
    const code = variableImportCode(vars);
    assert.match(code, /const DO_CREATE = true;/);
    assert.match(code, /const DO_ALIAS = true;/);
  });

  test('create-only chunk does not wire aliases', () => {
    const code = variableImportCode(vars, { passes: ['create'] });
    assert.match(code, /const DO_CREATE = true;/);
    assert.match(code, /const DO_ALIAS = false;/);
    // pass 2 iterates an empty object when aliases are off
    assert.match(code, /Object\.entries\(DO_ALIAS \? VARS : \{\}\)/);
  });

  test('alias-only chunk skips value writes but still rebuilds the lookup ctx', () => {
    const code = variableImportCode(vars, { passes: ['alias'] });
    assert.match(code, /const DO_CREATE = false;/);
    assert.match(code, /if \(!DO_CREATE\) break;/);
    assert.match(code, /ctx\[collName\] = \{ modeIds, vars \};/);
  });

  test('both chunk shapes stay valid standalone programs', () => {
    for (const passes of [['create'], ['alias'], ['create', 'alias']]) {
      const code = variableImportCode(vars, { passes });
      // new Function parses (does not run) the source — a real syntax check
      assert.doesNotThrow(() => new Function(`return ${code}`), `syntax error for passes=${passes}`);
      assert.match(code, /^\(async \(\) => \{/);
      assert.match(code, /JSON\.stringify\(\{ collections/);
    }
  });
});
