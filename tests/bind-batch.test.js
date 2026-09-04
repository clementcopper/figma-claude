import { describe, it } from 'node:test';
import assert from 'node:assert';
import { bindBatchCode } from '../src/commands/variables.js';

// One bad entry (a COLOR variable on cornerRadius) threw inside the loop, the eval aborted,
// and every binding after it was lost with a generic error.

describe('bindBatchCode', () => {
  const code = bindBatchCode([{ nodeId: '1:2', property: 'fill', variable: 'color/brand' }, { nodeId: '1:3', property: 'cornerRadius', variable: 'radius/md' }]);

  it('guards every entry on its own and reports per entry', () => {
    assert.ok((code.match(/try \{/g) || []).length >= 1);
    assert.match(code, /ok: false/);
    assert.match(code, /\.ok = true/);
  });

  it('checks the variable type before a number property', () => {
    assert.match(code, /resolvedType/);
    assert.match(code, /FLOAT/);
  });

  it('compiles', () => {
    assert.doesNotThrow(() => new Function(code), SyntaxError);
  });
});
