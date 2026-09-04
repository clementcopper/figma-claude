import { describe, it } from 'node:test';
import assert from 'node:assert';
import { hexToRgb, rgbToHex, toHex, COLOR_SNIPPET } from '../src/lib/plugin-color.js';

describe('plugin-color', () => {
  it('parses 3-, 6- and 8-digit hex and answers null otherwise', () => {
    assert.deepStrictEqual(hexToRgb('#fff'), { r: 1, g: 1, b: 1 });
    assert.deepStrictEqual(hexToRgb('000000'), { r: 0, g: 0, b: 0 });
    assert.strictEqual(hexToRgb('#ff000080').a, 128 / 255);
    for (const bad of ['zzz', '#12', '', null, undefined, 12]) assert.strictEqual(hexToRgb(bad), null);
  });

  it('formats and round-trips', () => {
    assert.strictEqual(rgbToHex(1, 0, 0.5), '#ff0080');
    assert.strictEqual(toHex(hexToRgb('#3b82f6')), '#3b82f6');
    assert.strictEqual(rgbToHex(1.2, -1, 0), '#ff0000', 'clamped');
  });

  it('ships the same functions as plugin-side source', () => {
    const fns = new Function(COLOR_SNIPPET + '; return { hexToRgb, rgbToHex, toHex };')();
    assert.deepStrictEqual(fns.hexToRgb('#3b82f6'), hexToRgb('#3b82f6'));
    assert.strictEqual(fns.toHex({ r: 0.2, g: 0.4, b: 0.6 }), toHex({ r: 0.2, g: 0.4, b: 0.6 }));
    assert.strictEqual(fns.hexToRgb('nope'), null);
  });
});
