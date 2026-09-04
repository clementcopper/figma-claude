import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseIdList, ID_LIST_HELP } from '../src/lib/id-list.js';

// Node-id lists came in five formats: variadic args (`node delete a b`), comma (`section add`),
// comma-or-JSON (`delete-batch`), comma-or-space (`--node`), comma-only (`stagger`). One parser:
// commas, spaces, newlines, a JSON array, or several argv entries — any mix.

describe('parseIdList', () => {
  it('accepts commas, spaces, newlines and a JSON array', () => {
    assert.deepStrictEqual(parseIdList('1:2,1:3'), ['1:2', '1:3']);
    assert.deepStrictEqual(parseIdList('1:2 1:3\n1:4'), ['1:2', '1:3', '1:4']);
    assert.deepStrictEqual(parseIdList('["1:2", "1:3"]'), ['1:2', '1:3']);
  });

  it('flattens argv entries that themselves carry lists, and dedupes', () => {
    assert.deepStrictEqual(parseIdList(['1:2,1:3', '1:4', '1:2']), ['1:2', '1:3', '1:4']);
  });

  it('answers an empty list for nothing', () => {
    assert.deepStrictEqual(parseIdList(''), []);
    assert.deepStrictEqual(parseIdList(undefined), []);
    assert.deepStrictEqual(parseIdList([]), []);
  });

  it('keeps instance ids whole (they contain ; and :)', () => {
    assert.deepStrictEqual(parseIdList('I16:71;20:67 1:2'), ['I16:71;20:67', '1:2']);
  });

  it('has one help phrase for every command to reuse', () => {
    assert.match(ID_LIST_HELP, /comma|space/);
  });
});
