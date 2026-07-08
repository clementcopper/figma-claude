import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FigmaClient } from '../src/figma-client.js';

function assertValidJs(code) {
  assert.doesNotThrow(() => new Function(code), SyntaxError);
}

describe('numeric width wraps <Text> in a row', () => {
  const client = new FigmaClient();

  it('emits HEIGHT autoresize + fixed sizing + resize for w={200} in flex=row', async () => {
    const code = await client.parseJSX('<Frame name="P" flex="row"><Text size={14} w={200}>a very long line of text that should wrap</Text></Frame>');
    assert.ok(/textAutoResize = 'HEIGHT'/.test(code), 'HEIGHT autoresize');
    assert.ok(/layoutSizingHorizontal = 'FIXED'/.test(code), 'FIXED sizing');
    assert.ok(/\.resize\(200,/.test(code), 'resize to 200');
    assertValidJs(code);
  });

  it('does not add fixed-width code for w="fill"', async () => {
    const code = await client.parseJSX('<Frame name="P" flex="row"><Text size={14} w="fill">x</Text></Frame>');
    assert.ok(!/el\d+\.resize\(/.test(code), 'text element does not resize for fill');
    assert.ok(/layoutSizingHorizontal = 'FILL'/.test(code), 'FILL path kept');
  });
});
