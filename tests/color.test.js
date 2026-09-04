import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseHexColor } from '../src/lib/color.js';

// `set fill zzz` destructured `hexToRgb('zzz')`, which throws, and nothing caught it: a Node
// stack trace instead of one line naming the value. The commands now ask this first.

describe('parseHexColor', () => {
  it('accepts 3-, 6- and 8-digit hex with or without #', () => {
    assert.deepStrictEqual(parseHexColor('#fff'), { r: 1, g: 1, b: 1 });
    assert.deepStrictEqual(parseHexColor('000000'), { r: 0, g: 0, b: 0 });
    const c = parseHexColor('#ff000080');
    assert.strictEqual(c.r, 1); assert.strictEqual(c.g, 0); assert.strictEqual(c.b, 0);
    assert.ok(Math.abs(c.a - 128 / 255) < 1e-9);
  });

  it('answers null for anything else, never throws', () => {
    for (const bad of ['zzz', '#12', 'rgb(0,0,0)', '', undefined, null, '#ggg']) {
      assert.strictEqual(parseHexColor(bad), null, `"${bad}"`);
    }
  });
});
