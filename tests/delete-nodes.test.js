import { describe, it } from 'node:test';
import assert from 'node:assert';
import { deleteNodesCode, deletePlan, formatDeleteResult } from '../src/lib/delete-nodes.js';

// Three delete commands, three behaviours: `node delete` exited 1 on a missing id,
// `delete`/`remove` removed the whole selection without a word and exited 0, `delete-batch`
// exited 0 whatever happened. One plan, one code path, one report.

describe('deletePlan', () => {
  it('deletes the given ids', () => {
    assert.deepStrictEqual(deletePlan({ ids: ['1:2'], selectionCount: 5 }), { ids: ['1:2'] });
  });

  it('with no ids takes one selected node, and refuses several without --yes', () => {
    assert.deepStrictEqual(deletePlan({ ids: [], selectionCount: 1 }), { selection: true });
    assert.match(deletePlan({ ids: [], selectionCount: 3 }).refuse, /3 nodes.*--yes/);
    assert.deepStrictEqual(deletePlan({ ids: [], selectionCount: 3, yes: true }), { selection: true });
    assert.match(deletePlan({ ids: [], selectionCount: 0 }).refuse, /nothing selected/i);
  });
});

describe('deleteNodesCode', () => {
  it('reports deleted and missing ids and compiles', () => {
    const code = deleteNodesCode(['1:2', '1:3']);
    assert.match(code, /missing/);
    assert.match(code, /getNodeByIdAsync/);
    assert.doesNotThrow(() => new Function(code), SyntaxError);
    assert.doesNotThrow(() => new Function(deleteNodesCode(null)), SyntaxError, 'selection form');
  });
});

describe('formatDeleteResult', () => {
  it('lists what went, names what was missing, and fails when anything was', () => {
    const r = formatDeleteResult({ deleted: [{ id: '1:2', name: 'A' }], missing: ['9:9'] });
    assert.match(r.lines.join('\n'), /Deleted 1:2/);
    assert.match(r.lines.join('\n'), /Not found: 9:9/);
    assert.strictEqual(r.exitCode, 1);
    assert.strictEqual(formatDeleteResult({ deleted: [], missing: [] }).exitCode, 0);
  });
});
