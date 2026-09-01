import { describe, it } from 'node:test';
import assert from 'node:assert';
import { autoFillDefeatsAlign } from '../src/lib/text-autofill.js';
import { FigmaClient } from '../src/figma-client.js';

const client = new FigmaClient();
const check = (jsx) => client.validateTextAlignment(jsx);

describe('autoFillDefeatsAlign', () => {
  // The JSX from the panel report, verbatim. It measured counterAxisAlignItems=MAX with
  // layoutSizingHorizontal=FILL and textAlignHorizontal=LEFT — the text stood left anyway.
  it('warns on the reported case', () => {
    const out = check('<Frame flex="col" w={300} p={10}><Frame flex="col" items="end" w="fill"><Text size={12}>rechts?</Text></Frame></Frame>');
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].items, 'end');
    assert.strictEqual(out[0].suggest, 'right');
    assert.strictEqual(out[0].text, 'rechts?');
  });

  it('suggests center for items="center"', () => {
    const out = check('<Frame flex="col" w={300}><Frame name="Meta" flex="col" items="center" w="fill"><Text>x</Text></Frame></Frame>');
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].suggest, 'center');
    assert.strictEqual(out[0].frame, 'Meta');
  });

  it('finds it at any nesting depth', () => {
    const out = check('<Frame flex="col" w={400}><Frame flex="row" w="fill"><Frame name="Deep" flex="col" items="end" w={120}><Text>y</Text></Frame></Frame></Frame>');
    assert.deepStrictEqual(out.map(o => o.frame), ['Deep']);
  });

  it('the root frame counts too', () => {
    const out = check('<Frame name="Root" flex="col" items="end" w={200}><Text>z</Text></Frame>');
    assert.deepStrictEqual(out.map(o => o.frame), ['Root']);
  });
});

describe('autoFillDefeatsAlign — what must stay quiet', () => {
  it('a <Text> that already carries align', () => {
    assert.deepStrictEqual(check('<Frame flex="col" w={300} items="end"><Text align="right">x</Text></Frame>'), []);
  });

  it('a <Text> with its own width — the generator does not auto-FILL it', () => {
    assert.deepStrictEqual(check('<Frame flex="col" w={300} items="end"><Text w={80}>x</Text></Frame>'), []);
    assert.deepStrictEqual(check('<Frame flex="col" w={300} items="end"><Text w="fill">x</Text></Frame>'), []);
  });

  it('a row — auto-FILL is a column rule', () => {
    assert.deepStrictEqual(check('<Frame flex="col" w={300}><Frame flex="row" items="end" w="fill"><Text>x</Text></Frame></Frame>'), []);
  });

  it('items="start" — FILLed text reads left anyway, so nothing was defeated', () => {
    assert.deepStrictEqual(check('<Frame flex="col" w={300} items="start"><Text>x</Text></Frame>'), []);
  });

  it('no items at all — the default was never a promise', () => {
    assert.deepStrictEqual(check('<Frame flex="col" w={300}><Text>x</Text></Frame>'), []);
  });

  it('a hugging column — it is as wide as its text, so alignment is moot', () => {
    assert.deepStrictEqual(check('<Frame flex="col" items="end"><Text>x</Text></Frame>'), []);
  });

  it('non-text children', () => {
    assert.deepStrictEqual(check('<Frame flex="col" w={300} items="end"><Ellipse w={8} h={8} bg="#000"/></Frame>'), []);
  });

  it('unparseable input returns [] rather than throwing', () => {
    assert.deepStrictEqual(check('not jsx at all'), []);
    assert.deepStrictEqual(autoFillDefeatsAlign(null, null), []);
  });
});
