// Tests for the extraction pipeline (src/lib/extract-run.js).
//
// This orchestration previously lived inline in the `extract` command and had
// NO coverage — yet it holds every degradation path (chunk halving, depth
// retreat, skip-and-continue). Those paths decide whether a "successful"
// extraction is complete or silently missing data, which is exactly what a
// contract-based validation must not get wrong.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runExtraction, ExtractionError, parseEvalResult } from '../src/lib/extract-run.js';

/**
 * A fake Figma bridge. Dispatches on the shape of the generated eval code, so
 * the tests exercise the REAL code generators from design-extract.js.
 * `overrides` can replace any handler or throw to simulate a failure.
 */
function fakeEval({ pages = [], fileName = 'Test File', collections = [], vars = {}, walk = {}, remote = null, hooks = {} } = {}) {
  const calls = { chunk: [], walk: [] };
  const fn = async (code) => {
    if (hooks.before) hooks.before(code, calls);
    if (code.includes('figma.root.name')) return JSON.stringify(fileName);
    if (code.includes('figma.root.children.map')) return JSON.stringify(pages);
    if (code.includes('figma.currentPage.selection')) return JSON.stringify(hooks.selection || { ids: [], pageId: '0:1', pageName: 'Page 1' });
    // NOTE: order matters — remoteAliasTargetsCode also calls
    // getLocalVariableCollectionsAsync and mentions variableIds, so its unique
    // marker has to be tested first.
    if (code.includes('const MAX =')) return JSON.stringify(remote || { collections: [], truncated: false });
    if (code.includes('getLocalVariableCollectionsAsync') && code.includes('variableIds')) return JSON.stringify(collections);
    if (code.includes('const ids = [')) {
      // variableChunkCode — echo back the requested ids as variables
      const ids = JSON.parse(code.match(/const ids = (\[[^\]]*\]);/)[1]);
      calls.chunk.push(ids.length);
      if (hooks.onChunk) hooks.onChunk(ids);
      return JSON.stringify(ids.map(id => vars[id] || { id, name: id, type: 'COLOR', values: { Value: '#000000' } }));
    }
    if (code.includes('const MAX_DEPTH =')) {
      const depth = Number(code.match(/const MAX_DEPTH = (\d+);/)[1]);
      const pageId = JSON.parse(code.match(/getNodeByIdAsync\((".*?")\)/)[1]);
      calls.walk.push({ depth, pageId, code });
      if (hooks.onWalk) { const r = hooks.onWalk(depth, pageId); if (r !== undefined) return JSON.stringify(r); }
      const page = pages.find(p => p.id === pageId) || { id: pageId, name: 'Page 1' };
      return JSON.stringify(walk[pageId] || { id: page.id, name: page.name, nodeCount: 1, frames: [] });
    }
    throw new Error(`unexpected eval: ${code.slice(0, 60)}`);
  };
  fn.calls = calls;
  return fn;
}

describe('parseEvalResult', () => {
  test('parses the stringified case and passes objects through', () => {
    assert.deepEqual(parseEvalResult('{"a":1}'), { a: 1 });
    assert.deepEqual(parseEvalResult({ a: 1 }), { a: 1 });
  });
});

describe('runExtraction — basics', () => {
  test('assembles fileName, pages and a date', async () => {
    const evalFn = fakeEval({ pages: [{ id: '0:1', name: 'Components' }] });
    const { extraction } = await runExtraction({ evalFn });
    assert.equal(extraction.fileName, 'Test File');
    assert.deepEqual(extraction.pages.map(p => p.name), ['Components']);
    assert.match(extraction.date, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('requires an evalFn rather than failing obscurely later', async () => {
    await assert.rejects(() => runExtraction({}), TypeError);
  });

  test('filters pages by case-insensitive substring', async () => {
    const evalFn = fakeEval({ pages: [{ id: '0:1', name: 'Components' }, { id: '0:2', name: 'Archive' }] });
    const { extraction } = await runExtraction({ evalFn, pages: 'compon' });
    assert.deepEqual(extraction.pages.map(p => p.name), ['Components']);
  });

  test('raises a user-fixable error when no page matches', async () => {
    const evalFn = fakeEval({ pages: [{ id: '0:1', name: 'Components' }] });
    await assert.rejects(() => runExtraction({ evalFn, pages: 'nope' }), ExtractionError);
  });

  test('raises a user-fixable error when the selection is empty', async () => {
    const evalFn = fakeEval({ hooks: { selection: { ids: [], pageId: '0:1', pageName: 'P' } } });
    await assert.rejects(() => runExtraction({ evalFn, selection: true }), ExtractionError);
  });

  test('selection mode scopes the walker to the selected ids', async () => {
    const evalFn = fakeEval({ hooks: { selection: { ids: ['5:1', '5:2'], pageId: '0:1', pageName: 'P' } } });
    await runExtraction({ evalFn, selection: true });
    assert.match(evalFn.calls.walk[0].code, /\["5:1","5:2"\]\.includes\(c\.id\)/);
  });
});

describe('runExtraction — variables', () => {
  const collections = [{ id: 'VC:1', name: 'primitives', modes: [{ id: 'm', name: 'Value' }], variableIds: ['V:1', 'V:2'] }];

  test('captures collections with their values', async () => {
    const evalFn = fakeEval({ pages: [], collections });
    const { extraction, droppedVars } = await runExtraction({ evalFn });
    assert.equal(extraction.variables.length, 1);
    assert.equal(extraction.variables[0].variables.length, 2);
    assert.equal(droppedVars, 0);
  });

  test('skips the variable pass entirely when sections exclude it', async () => {
    const evalFn = fakeEval({ pages: [], collections });
    const { extraction } = await runExtraction({ evalFn, sections: ['structure'] });
    assert.deepEqual(extraction.variables, []);
  });

  test('survives a file whose Figma build cannot list collections', async () => {
    const evalFn = fakeEval({ pages: [], collections });
    const wrapped = async (code) => {
      if (code.includes('getLocalVariableCollectionsAsync')) throw new Error('not supported');
      return evalFn(code);
    };
    const { extraction } = await runExtraction({ evalFn: wrapped });
    assert.deepEqual(extraction.variables, []);
  });

  test('halves the chunk size on a payload error instead of losing the collection', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `V:${i}`);
    const base = fakeEval({ pages: [], collections: [{ id: 'VC:1', name: 'big', modes: [{ id: 'm', name: 'Value' }], variableIds: ids }] });
    let firstBig = true;
    const wrapped = async (code) => {
      if (code.includes('const ids = [')) {
        const n = JSON.parse(code.match(/const ids = (\[[^\]]*\]);/)[1]).length;
        if (n === 200 && firstBig) { firstBig = false; throw new Error('payload too large'); }
      }
      return base(code);
    };
    const { extraction, droppedVars } = await runExtraction({ evalFn: wrapped });
    assert.equal(droppedVars, 0, 'nothing may be dropped when halving succeeds');
    assert.equal(extraction.variables[0].variables.length, 200, 'every variable is still captured');
    assert.ok(base.calls.chunk.includes(100), `expected a halved 100-id chunk, saw ${base.calls.chunk}`);
  });

  test('counts variables it had to drop, so "no variables" cannot be confused with "unreadable"', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `V:${i}`);
    const base = fakeEval({ pages: [], collections: [{ id: 'VC:1', name: 'c', modes: [{ id: 'm', name: 'Value' }], variableIds: ids }] });
    const wrapped = async (code) => {
      if (code.includes('const ids = [')) throw new Error('boom');   // non-retryable
      return base(code);
    };
    const { extraction, droppedVars } = await runExtraction({ evalFn: wrapped });
    assert.equal(droppedVars, 20);
    assert.equal(extraction.variables[0].variables.length, 0);
  });

  test('--resolve-remote captures library primitives and reports stats', async () => {
    const evalFn = fakeEval({
      pages: [], collections,
      remote: { collections: [{ id: 'VC:R', name: 'base', modes: [{ id: 'm', name: 'Value' }], ids: ['R:1', 'R:2', 'R:3'] }], truncated: true },
    });
    const { extraction, remoteStats } = await runExtraction({ evalFn, resolveRemote: true });
    assert.equal(extraction.variables.length, 2);
    assert.equal(extraction.variables[1].remote, true);
    assert.deepEqual(remoteStats, { collections: 1, variables: 3, truncated: true, error: undefined });
  });

  test('disambiguates a library collection that shares a local name', async () => {
    const evalFn = fakeEval({
      pages: [], collections,
      remote: { collections: [{ id: 'VC:R', name: 'primitives', modes: [{ id: 'm', name: 'Value' }], ids: ['R:1'] }] },
    });
    const { extraction } = await runExtraction({ evalFn, resolveRemote: true });
    assert.deepEqual(extraction.variables.map(c => c.name), ['primitives', 'primitives (library)']);
  });
});

describe('runExtraction — page degradation', () => {
  test('retries a too-large page at a shallower depth and records it', async () => {
    const evalFn = fakeEval({
      pages: [{ id: '0:1', name: 'Huge' }],
      hooks: { onWalk: (depth) => { if (depth > 6) throw new Error('payload too large'); } },
    });
    const { extraction } = await runExtraction({ evalFn });
    assert.equal(extraction.pages[0].reducedDepth, 6, 'the reduced depth must stay visible in the output');
    assert.deepEqual(evalFn.calls.walk.map(w => w.depth), [8, 6]);
  });

  test('records the page with an error instead of aborting the whole extraction', async () => {
    const evalFn = fakeEval({
      pages: [{ id: '0:1', name: 'Broken' }, { id: '0:2', name: 'Fine' }],
      hooks: { onWalk: (_d, id) => { if (id === '0:1') throw new Error('something else'); } },
    });
    const { extraction } = await runExtraction({ evalFn });
    assert.equal(extraction.pages[0].error, 'something else');
    assert.equal(extraction.pages[1].name, 'Fine');
    assert.equal(extraction.pages.length, 2);
  });

  test('gives up at the depth floor and says so', async () => {
    const evalFn = fakeEval({
      pages: [{ id: '0:1', name: 'Monster' }],
      hooks: { onWalk: () => { throw new Error('payload too large'); } },
    });
    const { extraction } = await runExtraction({ evalFn });
    assert.match(extraction.pages[0].error, /exceeded payload limit even at depth 3/);
    assert.deepEqual(evalFn.calls.walk.map(w => w.depth), [8, 6, 4]);
  });
});

describe('runExtraction — progress', () => {
  test('reports progress so a caller can drive a spinner', async () => {
    const seen = [];
    const evalFn = fakeEval({ pages: [{ id: '0:1', name: 'Components' }] });
    await runExtraction({ evalFn, onProgress: (t) => seen.push(t) });
    assert.ok(seen.some(t => /Page 1\/1: Components/.test(t)));
  });
});
