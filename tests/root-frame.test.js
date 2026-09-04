import { describe, it } from 'node:test';
import assert from 'node:assert';
import { matchRootFrame } from '../src/lib/root-frame.js';
import { FigmaClient } from '../src/figma-client.js';

// The root <Frame> was found with /<Frame\s+([^>]*)>/ — neither anchored nor attribute-optional.
// `<Frame>\n<Frame name="inner">…` made the INNER frame the root (the wrapper and every sibling
// silently dropped), and a plain `<Frame>` was refused with "must start with <Frame>".

describe('matchRootFrame', () => {
  it('takes the first tag, attribute-less or not, after leading whitespace', () => {
    assert.deepStrictEqual(matchRootFrame('<Frame><Text>hi</Text></Frame>'), { propsStr: '', end: 7 });
    const open = '\n  <Frame name="A" gap={8}>';
    assert.deepStrictEqual(matchRootFrame(open + '\n</Frame>'), { propsStr: 'name="A" gap={8}', end: open.length });
  });

  it('never skips ahead to a nested Frame', () => {
    assert.deepStrictEqual(matchRootFrame('<Frame>\n<Frame name="inner"></Frame>\n</Frame>'), { propsStr: '', end: 7 });
  });

  it('returns null when the JSX does not start with a Frame', () => {
    assert.strictEqual(matchRootFrame('<Text>x</Text>'), null);
    assert.strictEqual(matchRootFrame('<FrameX name="a">'), null);
  });
});

describe('parseJSX root frame', () => {
  const client = new FigmaClient();
  it('keeps an attribute-less wrapper as the root', async () => {
    const code = await client.parseJSX('<Frame><Frame name="inner"><Text>x</Text></Frame></Frame>');
    assert.doesNotMatch(code, /frame\.name = "inner"/);
    assert.match(code, /createFrame\(\)/);
  });
});
