import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FigmaClient } from '../src/figma-client.js';

describe('decodeEntities', () => {
  const client = new FigmaClient();

  it('decodes named entities', () => {
    assert.equal(client.decodeEntities('a &amp; b'), 'a & b');
    assert.equal(client.decodeEntities('x &rarr; y'), 'x → y');
    assert.equal(client.decodeEntities('&lt;tag&gt;'), '<tag>');
  });

  it('decodes decimal and hex numeric entities', () => {
    assert.equal(client.decodeEntities('&#8250;'), '›');
    assert.equal(client.decodeEntities('&#x203A;'), '›');
  });

  it('leaves unknown entities untouched', () => {
    assert.equal(client.decodeEntities('&bogus; &notreal;'), '&bogus; &notreal;');
  });

  it('is a no-op on strings without &', () => {
    assert.equal(client.decodeEntities('plain text'), 'plain text');
  });

  it('decodes nbsp to a non-breaking space (U+00A0)', () => {
    assert.equal(client.decodeEntities('a&nbsp;b'), 'a b');
  });

  it('leaves a malformed numeric entity untouched', () => {
    assert.equal(client.decodeEntities('&#12e;'), '&#12e;');
  });
});

describe('parseJSX decodes entities in <Text>', () => {
  const client = new FigmaClient();
  it('emits decoded characters', async () => {
    const code = await client.parseJSX('<Frame name="P" flex="col"><Text size={14}>6 calls &#8250; done</Text></Frame>');
    assert.ok(code.includes('6 calls › done'), 'decoded › in characters');
  });
});
