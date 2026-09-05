import { describe, it } from 'node:test';
import assert from 'node:assert';
import { strictVarsFailed } from '../src/commands/render.js';

// `bg="var:gibt-es-nicht"` rendered a grey placeholder with a warning and exit 0; a script
// chaining renders never saw it. `--strict-vars` turns the warning into exit 1; the default
// stays, because a placeholder is what you want while iterating.

describe('strictVarsFailed', () => {
  it('is true only with --strict-vars and an unresolved reference', () => {
    assert.strictEqual(strictVarsFailed(['gibt-es-nicht'], { strictVars: true }), true);
    assert.strictEqual(strictVarsFailed([], { strictVars: true }), false);
    assert.strictEqual(strictVarsFailed(['gibt-es-nicht'], {}), false);
    assert.strictEqual(strictVarsFailed(undefined, { strictVars: true }), false);
  });
});
