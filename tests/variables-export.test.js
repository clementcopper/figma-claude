import { describe, it } from 'node:test';
import assert from 'node:assert';
import { weightFromStyle, rgbaToHex, variablesExportCode, shapeExport, summarize } from '../src/lib/variables-export.js';
import { varExportOutput } from '../src/commands/variables.js';

// The read-out side existed for weeks with no command wired to it and no test.

describe('variables-export', () => {
  it('maps Figma style names to CSS weights, heaviest first', () => {
    assert.strictEqual(weightFromStyle('SemiBold'), 600);
    assert.strictEqual(weightFromStyle('Extra Bold Italic'), 800);
    assert.strictEqual(weightFromStyle('Italic'), 400);
    assert.strictEqual(weightFromStyle('Display'), null);
  });

  it('formats colours with alpha only when it carries information', () => {
    assert.strictEqual(rgbaToHex({ r: 1, g: 0, b: 0, a: 1 }), '#ff0000');
    assert.strictEqual(rgbaToHex({ r: 1, g: 0, b: 0, a: 0.5 }), '#ff000080');
  });

  it('the eval compiles', () => {
    assert.doesNotThrow(() => new Function(variablesExportCode()), SyntaxError);
  });

  it('shapes the raw read and summarises it', () => {
    const raw = { file: 'F', collections: [{ name: 'C', modes: ['Light'], variables: [{ name: 'a', values: { Light: { alias: 'b' } } }, { name: 'b', values: { Light: { value: '#fff' } } }] }],
      textStyles: [{ name: 'H1', fontStyle: 'Bold', lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PERCENT', value: 2 } }] };
    const shaped = shapeExport(JSON.stringify(raw));
    assert.strictEqual(shaped.textStyles[0].fontWeight, 700);
    assert.deepStrictEqual(shaped.textStyles[0].lineHeight, { unit: 'AUTO' });
    assert.match(summarize(shaped), /1 collection\(s\), 1 mode\(s\), 2 variable\(s\) \(1 alias\), 1 text style\(s\)/);
  });
});

describe('var export', () => {
  const raw = { file: 'F', collections: [], textStyles: [] };
  it('prints JSON with --json and a summary without', () => {
    assert.deepStrictEqual(JSON.parse(varExportOutput(raw, { json: true })), shapeExport(raw));
    assert.match(varExportOutput(raw, {}), /0 collection\(s\)/);
  });
});
