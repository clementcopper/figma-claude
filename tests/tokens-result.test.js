import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resultOrThrow } from '../src/commands/tokens.js';

// `figmaUse(code, { silent: true })` answers null for any error, and the tokens presets did
// `result?.trim() || 'Created spacing scale'`: against a disconnected Figma, `tokens ds`
// printed five green checkmarks and "~74 variables across 5 collections" having created
// nothing, exit 0. Null is a failure, and the failure has a message.

describe('resultOrThrow', () => {
  it('passes a real result through, trimmed', () => {
    assert.strictEqual(resultOrThrow('  12 variables\n'), '12 variables');
    assert.strictEqual(resultOrThrow(''), '');
  });

  it('throws on null, carrying the eval error when there is one', () => {
    assert.throws(() => resultOrThrow(null, new Error('Plugin not connected')), /Plugin not connected/);
    assert.throws(() => resultOrThrow(null), /no result/i);
  });
});
