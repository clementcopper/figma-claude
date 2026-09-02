import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveExportScale, exportScaleSnippet, FIGMA_MAX_PIXELS } from '../src/lib/verify-export.js';

describe('resolveExportScale', () => {
  it('hands back what was asked for when it fits', () => {
    assert.deepStrictEqual(resolveExportScale({ width: 500, height: 300 }, 3, 2000),
      { scale: 3, clamped: false, reason: null });
  });

  // The panel's case: a 500px frame with 36px rings and 9px text, judged unreadable and assumed
  // broken until the same node came back at 3x and turned out to be right.
  it('3x on a 500px frame stays 3x', () => {
    assert.strictEqual(resolveExportScale({ width: 500, height: 120 }, 3, 2000).scale, 3);
  });

  it('caps against the caller budget and says so', () => {
    const out = resolveExportScale({ width: 500, height: 300 }, 10, 2000);
    assert.strictEqual(out.scale, 4);
    assert.strictEqual(out.clamped, true);
    assert.match(out.reason, /2000px/);
  });

  // A budget above Figma's own ceiling must not win, or the export is refused outright.
  it("Figma's 7500px limit wins over a larger budget", () => {
    const out = resolveExportScale({ width: 5000, height: 100 }, 3, 20000);
    assert.strictEqual(out.scale, FIGMA_MAX_PIXELS / 5000);
    assert.match(out.reason, /7500/);
  });

  it('falls back to 1 for a scale that is not a usable number', () => {
    for (const bad of [0, -2, NaN, undefined, null, 'x', true]) {
      assert.strictEqual(resolveExportScale({ width: 100, height: 100 }, bad, 2000).scale, 1, String(bad));
    }
  });

  it('survives a node with no size', () => {
    assert.strictEqual(resolveExportScale({}, 2, 2000).scale, 2);
    assert.strictEqual(resolveExportScale(null, 2, 2000).scale, 2);
  });
});

describe('exportScaleSnippet', () => {
  // The snippet runs inside Figma where the module cannot be imported. Two hand-written copies
  // is what caused the drift, so the generated one is held against the function it mirrors.
  const run = (node, requested, maxDim) =>
    new Function('node', `return ${exportScaleSnippet(requested, maxDim)};`)(node);

  it('agrees with resolveExportScale on every case above', () => {
    const cases = [
      [{ width: 500, height: 300 }, 3, 2000],
      [{ width: 500, height: 300 }, 10, 2000],
      [{ width: 5000, height: 100 }, 3, 20000],
      [{ width: 100, height: 100 }, 1, 2000],
      [{ width: 40, height: 40 }, 8, 2000]
    ];
    for (const [node, requested, maxDim] of cases) {
      const mine = run(node, requested, maxDim);
      const theirs = resolveExportScale(node, requested, maxDim);
      assert.strictEqual(mine.scale, theirs.scale, JSON.stringify([node, requested, maxDim]));
      assert.strictEqual(mine.reason, theirs.reason, JSON.stringify([node, requested, maxDim]));
    }
  });

  it('is a self-contained expression — no imports reach into Figma', () => {
    assert.doesNotMatch(exportScaleSnippet(1, 2000), /import|require|resolveExportScale/);
  });
});
