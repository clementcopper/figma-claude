import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FigmaClient, LAYOUT_WARN_PRELUDE } from '../src/figma-client.js';

/**
 * The most destructive auto-layout failure: a child set to FILL an axis its
 * parent HUGs. Figma's UI disables "fill container" there; the Plugin API
 * accepts it, resolves it to nothing, and the element collapses to its seed
 * size and disappears — with no error anywhere.
 *
 * Measured live before the fix:
 *   <Frame flex="col" p={8}><Frame w="fill" h={20}/></Frame>
 *   -> child 1x20, parent 17 wide. Invisible.
 *
 * Two things guard it now: the 1px seed is reserved for dividers (which is what
 * it was built for), and a runtime check reports the conflict.
 */
describe('fill-in-hug: the 1px seed is for dividers only', () => {
  const client = new FigmaClient();

  const blockFor = (code, name) => {
    const lines = code.split('\n');
    const i = lines.findIndex((l) => l.includes(`"${name}"`));
    assert.ok(i >= 0, `no generated block for "${name}"`);
    return lines.slice(i, i + 30).join('\n');
  };

  it('an ordinary fill child is NOT seeded at 1px (it would vanish)', async () => {
    const code = await client.parseJSX(
      '<Frame name="P" flex="col" p={8}><Frame name="kid" w="fill" h={20} bg="#3b82f6" /></Frame>'
    );
    assert.match(blockFor(code, 'kid'), /resize\(100, 20\)/);
  });

  it('a stretch divider IS still seeded at 1px', async () => {
    const code = await client.parseJSX(
      '<Frame name="P" flex="row"><Frame name="D" w={1} stretch={true} bg="#999" /></Frame>'
    );
    assert.match(blockFor(code, 'D'), /resize\(1, 1\)/);
  });

  it('a thin auto-filled divider IS still seeded at 1px', async () => {
    const code = await client.parseJSX(
      '<Frame name="P" flex="row"><Frame name="D" w={1} bg="#999" /></Frame>'
    );
    assert.match(blockFor(code, 'D'), /resize\(1, 1\)/);
  });

  it('a grow spacer is not treated as a divider', async () => {
    const code = await client.parseJSX(
      '<Frame name="P" flex="row" w={300}><Frame name="S" grow={1} /><Frame name="B" w={40} h={20} bg="#999" /></Frame>'
    );
    assert.match(blockFor(code, 'S'), /resize\(100, 100\)/);
  });
});

describe('fill-in-hug: the runtime guard', () => {
  const client = new FigmaClient();

  it('records a check for every axis a child fills', async () => {
    const code = await client.parseJSX(
      '<Frame name="P" flex="col" w={200} h={100}><Frame name="kid" w="fill" h="fill" bg="#3b82f6" /></Frame>'
    );
    assert.match(code, /__figHugWarn\(el\d+, 'H'\)/);
    assert.match(code, /__figHugWarn\(el\d+, 'V'\)/);
  });

  it('adds no check when nothing fills', async () => {
    const code = await client.parseJSX(
      '<Frame name="P" flex="col"><Frame name="kid" w={40} h={20} bg="#3b82f6" /></Frame>'
    );
    assert.doesNotMatch(code, /__figHugWarn\(/);
  });

  it('flushes the pending checks before returning', async () => {
    const code = await client.parseJSX(
      '<Frame name="P" flex="col"><Frame name="kid" w="fill" h={20} /></Frame>'
    );
    // Match the CALL specifically — `__figHugFlush()` also appears in the
    // prelude's own comment, and in its `= () => {` definition.
    const call = 'globalThis.__figHugFlush();';
    assert.ok(code.includes(call), 'the flush is never called');
    assert.ok(
      code.lastIndexOf(call) > code.lastIndexOf('__figHugWarn(el'),
      'the flush must run after every child has been recorded'
    );
  });

  it('is redefined per render — a stale definition must not survive in the page', () => {
    // Figma's globalThis persists between evals. An "install once" guard pinned
    // whichever version ran first in that Figma session, so a fixed warning kept
    // reporting the old text until Figma itself was reloaded.
    assert.doesNotMatch(LAYOUT_WARN_PRELUDE, /if \(!globalThis\.__figHugWarn\)/);
    assert.match(LAYOUT_WARN_PRELUDE, /globalThis\.__layoutWarnings = \[\]/);
    assert.match(LAYOUT_WARN_PRELUDE, /globalThis\.__figHugPending = \[\]/);
  });

  it('is emitted once per render, not once per filling child', async () => {
    const code = await client.parseJSX(
      '<Frame name="P" flex="col" w={200}><Frame name="a" w="fill" h={10} /><Frame name="b" w="fill" h={10} /><Frame name="c" w="fill" h={10} /></Frame>'
    );
    const occurrences = code.split('__figHugFlush = ').length - 1;
    assert.strictEqual(occurrences, 1);
  });
});

describe('fill-in-hug: the guard logic itself', () => {
  // Exercise the emitted runtime function against fake nodes, so the sibling
  // rule is verified rather than assumed.
  const makeFlush = () => {
    const g = {};
    // eslint-disable-next-line no-new-func
    new Function('globalThis', LAYOUT_WARN_PRELUDE)(g);
    return g;
  };

  const node = (name, hz, vt) => ({ name, layoutSizingHorizontal: hz, layoutSizingVertical: vt });

  const parentOf = (layoutMode, primary, counter, kids) => {
    const p = { name: 'P', layoutMode, primaryAxisSizingMode: primary, counterAxisSizingMode: counter, children: kids };
    for (const k of kids) k.parent = p;
    return p;
  };

  it('warns when a lone child fills the axis its parent hugs', () => {
    const g = makeFlush();
    const kid = node('kid', 'FILL', 'FIXED');
    parentOf('VERTICAL', 'AUTO', 'AUTO', [kid]);
    g.__figHugWarn(kid, 'H');
    g.__figHugFlush();
    assert.strictEqual(g.__layoutWarnings.length, 1);
    assert.match(g.__layoutWarnings[0], /"kid" fills width/);
  });

  it('stays quiet when a sibling establishes the axis (the divider case)', () => {
    const g = makeFlush();
    const divider = node('div', 'FIXED', 'FILL');
    const label = node('Right', 'HUG', 'HUG');
    parentOf('HORIZONTAL', 'AUTO', 'AUTO', [divider, label]);
    g.__figHugWarn(divider, 'V');
    g.__figHugFlush();
    assert.deepStrictEqual(g.__layoutWarnings, []);
  });

  it('stays quiet when the parent is fixed on that axis', () => {
    const g = makeFlush();
    const kid = node('kid', 'FILL', 'FIXED');
    parentOf('VERTICAL', 'AUTO', 'FIXED', [kid]);
    g.__figHugWarn(kid, 'H');
    g.__figHugFlush();
    assert.deepStrictEqual(g.__layoutWarnings, []);
  });

  it('warns when EVERY child defers, so the size is circular', () => {
    const g = makeFlush();
    const a = node('a', 'FILL', 'HUG');
    const b = node('b', 'FILL', 'HUG');
    parentOf('VERTICAL', 'AUTO', 'AUTO', [a, b]);
    g.__figHugWarn(a, 'H');
    g.__figHugWarn(b, 'H');
    g.__figHugFlush();
    assert.strictEqual(g.__layoutWarnings.length, 2);
  });

  it('ignores a parent without auto-layout', () => {
    const g = makeFlush();
    const kid = node('kid', 'FILL', 'FIXED');
    parentOf('NONE', 'AUTO', 'AUTO', [kid]);
    g.__figHugWarn(kid, 'H');
    g.__figHugFlush();
    assert.deepStrictEqual(g.__layoutWarnings, []);
  });

  it('clears its pending list so a second render starts clean', () => {
    const g = makeFlush();
    const kid = node('kid', 'FILL', 'FIXED');
    parentOf('VERTICAL', 'AUTO', 'AUTO', [kid]);
    g.__figHugWarn(kid, 'H');
    g.__figHugFlush();
    g.__figHugFlush();
    assert.strictEqual(g.__layoutWarnings.length, 1, 'a second flush must not re-report');
  });
});
