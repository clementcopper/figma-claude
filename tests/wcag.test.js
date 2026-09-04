import { describe, it } from 'node:test';
import assert from 'node:assert';
import { luminance, contrastRatio, blend, textContrast, WCAG_SNIPPET } from '../src/lib/wcag.js';

// `a11y contrast` and `a11y audit` each carried their own copy of the WCAG maths and had
// drifted: contrast blended foreground AND background onto white, audit blended the
// foreground onto white and the background not at all. Semi-transparent text on a dark
// ground passed in one command and failed in the other. One source now, embedded into both.

const px = (r, g, b, a = 1) => ({ r: r / 255, g: g / 255, b: b / 255, a });

describe('wcag', () => {
  it('reproduces the reference ratios', () => {
    assert.strictEqual(Math.round(contrastRatio(luminance(0, 0, 0), luminance(1, 1, 1)) * 100) / 100, 21);
    const grey = px(0x77, 0x77, 0x77);
    assert.strictEqual(Math.round(textContrast(grey, px(255, 255, 255)).ratio * 100) / 100, 4.48);
  });

  it('blends the text onto its resolved background, not onto white', () => {
    // 50% white text on black: ~#808080 on black ≈ 5.3:1 — on white it would be ~1.9:1
    const { ratio } = textContrast(px(255, 255, 255, 0.5), px(0, 0, 0));
    assert.ok(ratio > 5 && ratio < 5.5, `got ${ratio}`);
  });

  it('ships the same functions as plugin-side source', () => {
    const fn = new Function(WCAG_SNIPPET + '; return textContrast;')();
    const a = fn(px(255, 255, 255, 0.5), px(0, 0, 0)).ratio;
    const b = textContrast(px(255, 255, 255, 0.5), px(0, 0, 0)).ratio;
    assert.strictEqual(a, b);
    assert.deepStrictEqual(blend(px(255, 0, 0, 0.5), px(0, 0, 0)), { r: 0.5, g: 0, b: 0 });
  });
});
