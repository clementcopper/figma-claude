// Library-primitive capture: `extract --resolve-remote`.
//
// The failure this guards against: a design system whose semantic tokens alias
// into an ENABLED LIBRARY (Primer → base/color, any team → "Foundations").
// extract can only read local collections, so those aliases point at nothing,
// and import recreates the tokens with no value — the whole file renders white.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  remoteAliasTargetsCode, danglingAliasNames, resolveAliases, buildVariableTokens,
  variablesCode, variableChunkCode,
} from '../src/design-extract.js';
import { variableImportCode } from '../src/design-md.js';

describe('remoteAliasTargetsCode', () => {
  const code = remoteAliasTargetsCode();

  test('is a self-contained async IIFE returning JSON', () => {
    assert.match(code, /^\(async \(\) => \{/);
    assert.match(code, /JSON\.stringify\(\{ collections/);
    assert.doesNotMatch(code, /\brequire\(/);
  });

  test('only follows aliases whose target is NOT local', () => {
    assert.match(code, /localIds\.has\(raw\.id\)/);
    assert.match(code, /!localIds\.has\(raw\.id\)/);
  });

  test('walks deeper so a library aliasing into another library is captured', () => {
    // enqueueAliases is called again for each remote variable, not just locals
    const calls = code.match(/enqueueAliases\(v\)/g) || [];
    assert.ok(calls.length >= 2, 'expected the BFS to re-enqueue from remote variables');
  });

  test('reads the target collection name and its real modes', () => {
    assert.match(code, /getVariableCollectionByIdAsync/);
    assert.match(code, /modes: \(rc && rc\.modes\)/);
  });

  test('falls back to a neutral name when the library collection is unreadable', () => {
    assert.match(code, /'library'/);
    assert.match(code, /name: 'default'/);
  });

  test('caps the walk so a huge library cannot run away', () => {
    assert.match(remoteAliasTargetsCode({ max: 42 }), /const MAX = 42;/);
    assert.match(code, /truncated = true/);
  });

  test('returns ids only — values come through the chunked path', () => {
    assert.doesNotMatch(code, /valuesByMode\[m\.id\]/);
    assert.match(code, /ids: \[\]/);
  });
});

describe('danglingAliasNames', () => {
  const collections = [{
    name: 'mode',
    modes: [{ id: 'm1', name: 'light' }],
    variables: [
      { id: 'V1', name: 'button/bg', type: 'COLOR', values: { light: { alias: 'base/green/5' } } },
      { id: 'V2', name: 'button/fg', type: 'COLOR', values: { light: { alias: 'fgColor/default' } } },
      { id: 'V3', name: 'fgColor/default', type: 'COLOR', values: { light: '#1f2328' } },
    ],
  }];

  test('reports alias targets that no captured collection defines', () => {
    assert.deepStrictEqual(danglingAliasNames(collections), ['base/green/5']);
  });

  test('is silent once the library collection is part of the export', () => {
    const withLibrary = collections.concat([{
      name: 'base/color',
      modes: [{ id: 'd', name: 'default' }],
      variables: [{ id: 'R1', name: 'base/green/5', type: 'COLOR', values: { default: '#1f883d' } }],
    }]);
    assert.deepStrictEqual(danglingAliasNames(withLibrary), []);
  });

  test('de-duplicates and sorts', () => {
    const many = [{
      name: 'mode', modes: [{ id: 'm', name: 'M' }],
      variables: [
        { id: 'A', name: 'a', type: 'COLOR', values: { M: { alias: 'z/1' } } },
        { id: 'B', name: 'b', type: 'COLOR', values: { M: { alias: 'z/1' } } },
        { id: 'C', name: 'c', type: 'COLOR', values: { M: { alias: 'a/1' } } },
      ],
    }];
    assert.deepStrictEqual(danglingAliasNames(many), ['a/1', 'z/1']);
  });

  test('handles files with no variables at all', () => {
    assert.deepStrictEqual(danglingAliasNames([]), []);
    assert.deepStrictEqual(danglingAliasNames([{ name: 'x', modes: [], variables: [] }]), []);
  });
});

describe('captured library collections roundtrip through import', () => {
  // What extract produces with --resolve-remote: the semantic collection plus
  // the library collection it aliases into, both as ordinary collections.
  const captured = [
    {
      id: 'C1', name: 'mode',
      modes: [{ id: 'm1', name: 'light' }, { id: 'm2', name: 'dark' }],
      variables: [{
        id: 'V1', name: 'button/primary/bgColor/rest', type: 'COLOR',
        values: { light: { alias: 'R1' }, dark: { alias: 'R2' } },
      }],
    },
    {
      id: 'C2', name: 'base/color', remote: true,
      modes: [{ id: 'd', name: 'default' }],
      variables: [
        { id: 'R1', name: 'base/color/green/5', type: 'COLOR', values: { default: '#1f883d' } },
        { id: 'R2', name: 'base/color/green/4', type: 'COLOR', values: { default: '#238636' } },
      ],
    },
  ];

  test('alias ids resolve to library variable names', () => {
    const resolved = resolveAliases(captured);
    assert.deepStrictEqual(resolved[0].variables[0].values, {
      light: { alias: 'base/color/green/5', collection: 'base/color' },
      dark: { alias: 'base/color/green/4', collection: 'base/color' },
    });
  });

  test('the library lands in the token block as its own collection', () => {
    const tokens = buildVariableTokens(resolveAliases(captured));
    assert.deepStrictEqual(Object.keys(tokens), ['mode', 'base/color']);
    assert.strictEqual(tokens['base/color'].variables['base/color/green/5'].values.default, '#1f883d');
  });

  test('import wires the chain instead of leaving empty values', () => {
    const code = variableImportCode(buildVariableTokens(resolveAliases(captured)));
    assert.match(code, /base\/color\/green\/5/);
    assert.match(code, /createVariableAlias/);
    // both collections are created before aliases are wired (two-pass import)
    assert.match(code, /PASS 1/);
    assert.match(code, /PASS 2/);
  });

  // The shape that breaks name-only resolution: a themed library ships the SAME
  // primitive name in a light and a dark collection. Seen in the wild (Primer
  // exports 7 such collections), but it is a generic pattern — any system with
  // per-theme primitive collections hits it.
  const themed = [
    {
      id: 'C1', name: 'mode',
      modes: [{ id: 'm1', name: 'light' }, { id: 'm2', name: 'dark' }],
      variables: [{
        id: 'V1', name: 'bg/emphasis', type: 'COLOR',
        values: { light: { alias: 'L1' }, dark: { alias: 'D1' } },
      }],
    },
    {
      id: 'C2', name: 'base/color/light', remote: true, modes: [{ id: 'd', name: 'default' }],
      variables: [{ id: 'L1', name: 'base/color/green/5', type: 'COLOR', values: { default: '#1a7f37' } }],
    },
    {
      id: 'C3', name: 'base/color/dark', remote: true, modes: [{ id: 'd', name: 'default' }],
      variables: [{ id: 'D1', name: 'base/color/green/5', type: 'COLOR', values: { default: '#238636' } }],
    },
  ];

  test('the capture keeps the alias id, not just the resolved name', () => {
    // Without aliasId the export cannot tell base/color/light's "neutral/1"
    // from base/color/dark's "neutral/1" — dark modes silently get light values.
    for (const code of [variablesCode(), variableChunkCode(['V:1'], [{ id: 'm', name: 'M' }])]) {
      assert.match(code, /aliasId: raw\.id/);
    }
  });

  test('an alias id pointing into a themed library keeps its collection', () => {
    const themedById = [
      { id: 'C1', name: 'mode', modes: [{ id: 'm1', name: 'light' }, { id: 'm2', name: 'dark' }],
        variables: [{ id: 'V1', name: 'bg', type: 'COLOR', values: {
          // `alias` is the NAME (identical in both library collections),
          // `aliasId` is what disambiguates.
          light: { alias: 'neutral/1', aliasId: 'L1' },
          dark: { alias: 'neutral/1', aliasId: 'D1' },
        } }] },
      { id: 'C2', name: 'base/color/light', modes: [{ id: 'd', name: 'default' }],
        variables: [{ id: 'L1', name: 'neutral/1', type: 'COLOR', values: { default: '#f6f8fa' } }] },
      { id: 'C3', name: 'base/color/dark', modes: [{ id: 'd', name: 'default' }],
        variables: [{ id: 'D1', name: 'neutral/1', type: 'COLOR', values: { default: '#0d1117' } }] },
    ];
    const resolved = resolveAliases(themedById);
    assert.deepStrictEqual(resolved[0].variables[0].values, {
      light: { alias: 'neutral/1', collection: 'base/color/light' },
      dark: { alias: 'neutral/1', collection: 'base/color/dark' },
    });
  });

  test('same primitive name in two library collections stays distinguishable', () => {
    const resolved = resolveAliases(themed);
    assert.deepStrictEqual(resolved[0].variables[0].values, {
      light: { alias: 'base/color/green/5', collection: 'base/color/light' },
      dark: { alias: 'base/color/green/5', collection: 'base/color/dark' },
    });
  });

  test('import prefers the qualified collection over a first-match by name', () => {
    const code = variableImportCode(buildVariableTokens(resolveAliases(themed)));
    assert.match(code, /if \(val\.collection\)/);
    assert.match(code, /ctx\[val\.collection\]/);
    assert.match(code, /collNameOfVar\.get\(x\.id\) === val\.collection/);
  });

  test('duplicate collection names are uniquified so the qualifier is unambiguous', () => {
    const dupes = [
      { id: 'A', name: 'base/color/light', modes: [{ id: 'd', name: 'default' }],
        variables: [{ id: 'A1', name: 'green', type: 'COLOR', values: { default: '#111111' } }] },
      { id: 'B', name: 'base/color/light', modes: [{ id: 'd', name: 'default' }],
        variables: [{ id: 'B1', name: 'green', type: 'COLOR', values: { default: '#222222' } }] },
      { id: 'C', name: 'mode', modes: [{ id: 'm', name: 'M' }],
        variables: [{ id: 'C1', name: 'x', type: 'COLOR', values: { M: { alias: 'B1' } } }] },
    ];
    const resolved = resolveAliases(dupes);
    assert.deepStrictEqual(resolved.map(c => c.name), ['base/color/light', 'base/color/light (2)', 'mode']);
    assert.deepStrictEqual(resolved[2].variables[0].values.M, { alias: 'green', collection: 'base/color/light (2)' });
    // and the token block keeps both collections instead of collapsing them
    assert.deepStrictEqual(
      Object.keys(buildVariableTokens(resolved)), ['base/color/light', 'base/color/light (2)', 'mode']);
  });

  test('without the library capture the same export dangles', () => {
    const localOnly = [captured[0]];
    const tokens = buildVariableTokens(resolveAliases(localOnly));
    // alias target stays a raw id — nothing to wire on import
    assert.deepStrictEqual(
      tokens.mode.variables['button/primary/bgColor/rest'].values.light, { alias: 'R1' });
    assert.deepStrictEqual(danglingAliasNames(localOnly), ['R1', 'R2']);
  });
});
