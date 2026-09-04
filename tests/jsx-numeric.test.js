import { describe, it } from 'node:test';
import assert from 'node:assert';
import { coerceNumericProps, NUMERIC_PROPS } from '../src/lib/jsx-numeric.js';
import { FigmaClient } from '../src/figma-client.js';

// Every numeric JSX prop was spliced into the generated Plugin API code as text:
// `gap="8px"` became `frame.itemSpacing = 8px` (a SyntaxError that failed the whole
// render) and `gap="0; figma.currentPage.children.length; //"` ran as code inside Figma.

describe('coerceNumericProps', () => {
  it('turns quoted numbers into numbers and strips a px suffix', () => {
    assert.deepStrictEqual(coerceNumericProps({ gap: '8', p: '12px', opacity: '0.5', w: '320' }),
      { gap: 8, p: 12, opacity: 0.5, w: 320 });
  });

  it('keeps the sizing keywords and percentages that w/h accept', () => {
    assert.deepStrictEqual(coerceNumericProps({ w: 'fill', h: 'hug', width: '50%', minW: '10' }),
      { w: 'fill', h: 'hug', width: '50%', minW: 10 });
  });

  it('keeps auto and percent on lineHeight and letterSpacing', () => {
    assert.deepStrictEqual(coerceNumericProps({ lineHeight: 'auto', letterSpacing: '5%', size: '14' }),
      { lineHeight: 'auto', letterSpacing: '5%', size: 14 });
  });

  it('leaves non-numeric props alone', () => {
    assert.deepStrictEqual(coerceNumericProps({ name: '12', bg: '#fff', flex: 'row' }),
      { name: '12', bg: '#fff', flex: 'row' });
  });

  it('throws, naming prop and value, on anything that is not a number', () => {
    assert.throws(() => coerceNumericProps({ gap: '8pxx' }), /gap="8pxx"/);
    assert.throws(() => coerceNumericProps({ rounded: 'full' }), /rounded="full"/);
    assert.throws(() => coerceNumericProps({ gap: '0; figma.currentPage.children.length; //' }), /gap=/);
    assert.throws(() => coerceNumericProps({ w: 'wide' }), /w="wide"/);
  });

  it('covers every prop the generators emit as a bare number', () => {
    for (const p of ['gap', 'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'x', 'y', 'w', 'h', 'width', 'height',
      'size', 'rounded', 'radius', 'opacity', 'strokeWidth', 'arc', 'arcStart', 'innerRadius', 'blur',
      'wrapGap', 'rowGap', 'counterAxisSpacing', 'minW', 'maxW', 'minH', 'maxH', 'rotate', 'grow']) {
      assert.ok(NUMERIC_PROPS.has(p), `${p} missing from NUMERIC_PROPS`);
    }
  });
});

describe('parseJSX with numeric props', () => {
  const client = new FigmaClient();
  const valid = (code) => assert.doesNotThrow(() => new Function(code), SyntaxError);

  it('accepts gap="8px" and emits itemSpacing = 8', async () => {
    const code = await client.parseJSX('<Frame name="A" flex="row" gap="8px" p="4px"><Text>x</Text></Frame>');
    assert.match(code, /itemSpacing = 8;/);
    assert.match(code, /paddingTop = 4;/);
    valid(code);
  });

  it('refuses a value that would have been spliced in as code', async () => {
    await assert.rejects(
      client.parseJSX('<Frame name="A" gap="0; figma.currentPage.children.length; //"><Text>x</Text></Frame>'),
      /gap=/);
  });

  it('coerces the batch path too', async () => {
    const codes = await client.parseJSXBatch(['<Frame name="A" flex="row" gap="8px"><Text>x</Text></Frame>']);
    const code = Array.isArray(codes) ? codes.join('\n') : String(codes);
    assert.match(code, /itemSpacing = 8;/);
    valid(code);
  });
});

describe('__currentNode labels', () => {
  const client = new FigmaClient();

  it('survive a backslash in text or a frame name', async () => {
    const code = await client.parseJSX('<Frame name="a\\\\b"><Frame name="c\\\\"><Text>C:\\\\path\\\\</Text></Frame></Frame>');
    assert.doesNotThrow(() => new Function(code), SyntaxError, code);
  });

  it("survive a quote-escape sequence that used to close the literal", async () => {
    const code = await client.parseJSX("<Frame name=\"A\"><Text>x\\\\'; figma.closePlugin(); '</Text></Frame>");
    assert.doesNotThrow(() => new Function(code), SyntaxError, code);
    assert.ok(!/^\s*figma\.closePlugin\(\);/m.test(code), 'injected statement must stay inside a string');
  });
});
