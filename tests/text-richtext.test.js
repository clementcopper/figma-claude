import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FigmaClient } from '../src/figma-client.js';

describe('parseTextRuns', () => {
  const client = new FigmaClient();

  it('returns a single empty-style run for plain text (fast path)', () => {
    const { text, runs } = client.parseTextRuns('Hello world');
    assert.equal(text, 'Hello world');
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0].style, {});
    assert.equal(runs[0].start, 0);
    assert.equal(runs[0].end, 11);
  });

  it('marks a <b> run bold with correct offsets', () => {
    const { text, runs } = client.parseTextRuns('a <b>bold</b> c');
    assert.equal(text, 'a bold c');
    const boldRun = runs.find(r => r.style.weight === 'bold');
    assert.ok(boldRun, 'has a bold run');
    assert.equal(text.slice(boldRun.start, boldRun.end), 'bold');
  });

  it('reads span overrides (color, weight)', () => {
    const { text, runs } = client.parseTextRuns('x <span color="#FAFAFA" weight="bold">cli</span> y');
    assert.equal(text, 'x cli y');
    const span = runs.find(r => r.style.color === '#FAFAFA');
    assert.ok(span, 'has colored run');
    assert.equal(span.style.weight, 'bold');
    assert.equal(text.slice(span.start, span.end), 'cli');
  });

  it('maps <em> to italic and <u> to underline', () => {
    const r1 = client.parseTextRuns('<em>hi</em>').runs.find(r => r.style.italic === true);
    assert.ok(r1, 'italic run');
    const r2 = client.parseTextRuns('<u>hi</u>').runs.find(r => r.style.underline === true);
    assert.ok(r2, 'underline run');
  });

  it('collapses internal whitespace and trims outer', () => {
    const { text } = client.parseTextRuns('\n  keep   memory\n  empty\n');
    assert.equal(text, 'keep memory empty');
  });

  it('decodes entities inside runs', () => {
    const { text } = client.parseTextRuns('a <b>&amp;</b> b');
    assert.equal(text, 'a & b');
  });

  it('trims outer whitespace even when content is wrapped in a boundary tag', () => {
    const { text, runs } = client.parseTextRuns('<span color="#FAFAFA"> alert </span>');
    assert.equal(text, 'alert');
    const styled = runs.find(r => r.style.color === '#FAFAFA');
    assert.ok(styled, 'styled run present');
    assert.equal(text.slice(styled.start, styled.end), 'alert');
  });
});

describe('parseJSX inline runs codegen', () => {
  const client = new FigmaClient();

  it('emits setRangeFontName for a <b> run and no setRange for plain text', async () => {
    const bold = await client.parseJSX('<Frame name="P" flex="col"><Text size={28} color="#9E9EA0">a <b>bold</b> c</Text></Frame>');
    assert.ok(/setRangeFontName\(2, 6,/.test(bold), 'bold range 2..6');
    assert.ok(bold.includes('a bold c'), 'flattened characters');

    const plain = await client.parseJSX('<Frame name="P" flex="col"><Text size={28}>just plain</Text></Frame>');
    assert.ok(!/setRange/.test(plain), 'no setRange calls for plain text (fast path)');
  });

  it('emits setRangeFills for a <span color> run', async () => {
    const code = await client.parseJSX('<Frame name="P" flex="col"><Text size={28} color="#9E9EA0">use <span color="#FAFAFA" weight="bold">figma-cli</span> now</Text></Frame>');
    assert.ok(/setRangeFills\(4, 13,/.test(code), 'colored range 4..13');
    assert.ok(/setRangeFontName\(4, 13,/.test(code), 'bold range 4..13');
    assert.ok(/r:0\.9803921568627451/.test(code) || /r:0\.98/.test(code), 'white-ish fill');
    assert.doesNotThrow(() => new Function(code), SyntaxError);
  });

  it('emits setRangeTextDecoration for <u>', async () => {
    const code = await client.parseJSX('<Frame name="P" flex="col"><Text size={28}>a <u>x</u></Text></Frame>');
    assert.ok(/setRangeTextDecoration\(2, 3, 'UNDERLINE'\)/.test(code), 'underline range');
  });
});
