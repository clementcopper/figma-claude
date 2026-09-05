import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FigmaClient } from '../src/figma-client.js';

// `render '<Frame name="X"><Text>x</Frame>'` printed a parser warning, then "✓ Rendered" and
// an empty 100×100 frame, exit 0. Content that parses to nothing is a broken tag, not an
// empty frame — the render must fail before anything reaches the canvas.

describe('parseJSX with content that parses to no element', () => {
  it('rejects an unclosed child tag and names what it saw', async () => {
    const client = new FigmaClient();
    await assert.rejects(
      client.parseJSX('<Frame name="X"><Text>x</Frame>'),
      /Invalid JSX: content inside <Frame> parsed to no element.*<Text>x/s
    );
  });

  it('still accepts an empty frame and a frame with a real child', async () => {
    const client = new FigmaClient();
    assert.ok(await client.parseJSX('<Frame name="X" w={100} h={100}>  </Frame>'));
    assert.ok(await client.parseJSX('<Frame name="X"><Text>x</Text></Frame>'));
  });
});
