import { describe, it } from 'node:test';
import assert from 'node:assert';
import { setTextCode } from '../src/commands/canvas-ops.js';

// `set text` loaded `t.fontName` — which is `figma.mixed` (a Symbol) on any text with more
// than one style run. loadFontAsync rejected and the whole command failed, for every target.

describe('setTextCode', () => {
  it('loads every font of a mixed-style text before writing characters', () => {
    const code = setTextCode('hello', "const targets = [];");
    assert.match(code, /figma\.mixed/);
    assert.match(code, /getRangeAllFontNames/);
    assert.ok(code.indexOf('loadFontAsync') < code.indexOf('.characters ='));
    assert.doesNotThrow(() => new Function(code), SyntaxError);
  });
});
