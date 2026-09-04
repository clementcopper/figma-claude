import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// `tokens tailwind -c "Brand A"` then `-c "Brand B"` created 0 variables in B: the "already
// exists" lookup matched a variable of that name in ANY collection. Six sites scoped by
// collection id, six did not.

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'commands', 'tokens.js'), 'utf8');

describe('tokens existence checks', () => {
  it('are scoped to the target collection', () => {
    const unscoped = [];
    src.split('\n').forEach((l, i) => {
      if (/existingVars\.find\(/.test(l) && !/variableCollectionId/.test(l)) unscoped.push(`${i + 1}: ${l.trim().slice(0, 90)}`);
    });
    assert.deepStrictEqual(unscoped, []);
  });
});
