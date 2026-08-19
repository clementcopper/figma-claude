import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseLastRender,
  buildUndoEval,
  undoLabel,
  undoMessage
} from '../dist/lib/render-undo.mjs';

describe('parseLastRender', () => {
  it('reads what render recorded', () => {
    const nodes = parseLastRender('{"nodes":[{"id":"1:2","name":"Hero"}],"at":"2026-08-19"}');
    assert.deepStrictEqual(nodes, [{ id: '1:2', name: 'Hero' }]);
  });

  it('treats every broken shape as nothing to undo', () => {
    assert.deepStrictEqual(parseLastRender(null), []);
    assert.deepStrictEqual(parseLastRender(''), []);
    assert.deepStrictEqual(parseLastRender('not json'), []);
    assert.deepStrictEqual(parseLastRender('{"nodes":"Hero"}'), []);
    assert.deepStrictEqual(parseLastRender('{"nodes":[{"name":"no id"}]}'), []);
  });

  it('keeps a node whose name is missing', () => {
    assert.deepStrictEqual(parseLastRender('{"nodes":[{"id":"1:2"}]}'), [{ id: '1:2', name: '' }]);
  });
});

describe('buildUndoEval', () => {
  it('removes exactly the recorded ids and nothing else', () => {
    const code = buildUndoEval(['1:2', '1:3']);
    assert.match(code, /\["1:2","1:3"\]/);
    assert.match(code, /getNodeByIdAsync/);
    // No search, no selection, no page walk — the ids are the whole input.
    assert.doesNotMatch(code, /findAll|currentPage|selection/);
  });

  it('is valid JavaScript', () => {
    assert.doesNotThrow(() => new Function(`return ${buildUndoEval(['1:2'])}`));
  });
});

describe('undoLabel', () => {
  it('names the count so a stale state file shows before the click', () => {
    assert.strictEqual(undoLabel([]), 'Nothing to undo');
    assert.strictEqual(undoLabel([{ id: '1:2', name: 'Hero' }]), 'Undo last render (Hero)');
    assert.strictEqual(
      undoLabel([{ id: '1:2', name: 'A' }, { id: '1:3', name: 'B' }]),
      'Undo last render (2 nodes)'
    );
  });
});

describe('undoMessage', () => {
  it('reports what actually went', () => {
    assert.strictEqual(undoMessage({ removed: 2, names: ['A', 'B'] }), 'Removed A, B');
    assert.strictEqual(undoMessage({ removed: 0, names: [] }), 'Nothing to undo — the nodes are already gone');
    assert.strictEqual(undoMessage(null), 'Nothing to undo — the nodes are already gone');
  });
});
