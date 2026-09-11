import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { suggestProp, KNOWN_PROPS } from '../src/lib/jsx-props.js';

// `<Text pb={8}>` was answered with `did you mean "w"?` — reported from the panel. The typo
// search accepted any known prop within edit distance 2, and for a two-letter prop every
// one-letter prop is exactly that far away. A suggestion has to fit the word, and a layout
// prop on <Text> deserves the real answer: padding lives on the parent Frame.

describe('suggestProp', () => {
  it('does not offer "w" for "pb"', () => {
    const r = suggestProp('pb', KNOWN_PROPS.Text, 'Text');
    assert.equal(r.suggestion, null);
  });

  it('tells <Text> that padding and layout belong on the parent Frame', () => {
    for (const prop of ['pb', 'p', 'px', 'padding', 'gap', 'flex', 'items', 'justify']) {
      const r = suggestProp(prop, KNOWN_PROPS.Text, 'Text');
      assert.equal(r.suggestion, null, prop);
      assert.match(r.hint, /parent <Frame>/, prop);
    }
  });

  it('still catches real typos', () => {
    assert.equal(suggestProp('rouned', KNOWN_PROPS.Frame, 'Frame').suggestion, 'rounded');
    assert.equal(suggestProp('widht', KNOWN_PROPS.Frame, 'Frame').suggestion, 'width');
    assert.equal(suggestProp('colr', KNOWN_PROPS.Text, 'Text').suggestion, 'color');
  });

  it('keeps the alias table first', () => {
    assert.equal(suggestProp('cornerRadius', KNOWN_PROPS.Frame, 'Frame').suggestion, 'rounded');
    assert.equal(suggestProp('fontSize', KNOWN_PROPS.Text, 'Text').suggestion, 'size');
  });

  it('a short unknown prop with nothing close gets no guess', () => {
    assert.equal(suggestProp('zq', KNOWN_PROPS.Frame, 'Frame').suggestion, null);
  });
});
