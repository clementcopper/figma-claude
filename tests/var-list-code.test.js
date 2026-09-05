import { describe, it } from 'node:test';
import assert from 'node:assert';
import { listVariablesCode } from '../src/commands/variables.js';

// `render`'s unresolved-variable hint said "Check `figma-cli var list` (optionally with
// --collection)" and `var list --collection` was `error: unknown option`. The filter follows
// `var delete-all -c`: case-insensitive, whole name or substring.

describe('listVariablesCode', () => {
  it('lists every collection without a filter', () => {
    const code = listVariablesCode({});
    assert.doesNotMatch(code, /toLowerCase\(\)/);
    assert.match(code, /getLocalVariablesAsync/);
  });
  it('filters by collection, case-insensitively, and returns name, type and collection', () => {
    const code = listVariablesCode({ collection: 'Semantic' });
    assert.match(code, /"semantic"/);
    assert.match(code, /toLowerCase\(\)/);
    assert.match(code, /collection: /);
  });
});
