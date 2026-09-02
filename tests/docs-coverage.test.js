import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { ALL_PROPS, KNOWN_PROPS } from '../src/lib/jsx-props.js';

// The four places a reader could plausibly look. A prop described in none of them exists only
// for whoever wrote the parser.
const DOCS = ['docs/FIGMA-USAGE.md', 'REFERENCE.md', 'README.md', 'skills/figma-cli/SKILL.md'];
const corpus = DOCS.map((f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');

// Props that exist and are written down nowhere, as of 2026-09-02. Named rather than tolerated:
// without this list the check would be red from its first run, and a permanently red line stops
// being read. Shrink it — never grow it to make a run pass.
const UNDOCUMENTED = new Set([
  'bgBlur',
  'centerOffsetX',
  'centerOffsetY',
  'clip',
  'imageScale',
  'innerShadow',
  'progressiveBlurStart'
]);

const documented = (prop) => new RegExp('\\b' + prop + '\\b').test(corpus);

describe('every JSX prop the parser accepts is described somewhere', () => {
  it('no prop outside the named backlog is undocumented', () => {
    const missing = ALL_PROPS.filter((p) => !UNDOCUMENTED.has(p) && !documented(p));
    assert.deepStrictEqual(missing, [],
      `these props exist but no doc mentions them:\n  ${missing.join(', ')}\n` +
      'Document them, or add them to UNDOCUMENTED with a reason.');
  });

  // A backlog nobody prunes is a backlog nobody believes. When an entry gets documented, this
  // fails and the list shrinks by one — the only direction it is allowed to move.
  it('the backlog contains nothing that is now documented', () => {
    const fixed = [...UNDOCUMENTED].filter(documented);
    assert.deepStrictEqual(fixed, [],
      `these are documented now — remove them from UNDOCUMENTED: ${fixed.join(', ')}`);
  });

  it('the backlog contains nothing the parser no longer accepts', () => {
    const gone = [...UNDOCUMENTED].filter((p) => !ALL_PROPS.includes(p));
    assert.deepStrictEqual(gone, [], `not props any more: ${gone.join(', ')}`);
  });
});

describe('the vocabulary itself', () => {
  it('every tag resolves to a list, aliases included', () => {
    for (const [tag, props] of Object.entries(KNOWN_PROPS)) {
      assert.ok(Array.isArray(props) && props.length > 0, `${tag} has no prop list`);
    }
  });

  it('Rect/Rectangle and Ellipse/Circle stay the same list', () => {
    assert.strictEqual(KNOWN_PROPS.Rectangle, KNOWN_PROPS.Rect);
    assert.strictEqual(KNOWN_PROPS.Circle, KNOWN_PROPS.Ellipse);
  });
});
