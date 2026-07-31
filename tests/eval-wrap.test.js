import { describe, it } from 'node:test';
import assert from 'node:assert';
import { wrapCodeIfNeeded } from '../src/lib/eval-wrap.js';

/**
 * `eval` code reaches Figma through CDP's Runtime.evaluate, which runs it as a
 * SCRIPT: a bare `return` is illegal there, and so is a bare `await`. The
 * wrapper decides whether the code needs an async IIFE around it.
 *
 * It used to guess with regexes that only looked for `return`, and only in
 * three shapes. Anything else came back as a raw SyntaxError from inside Figma,
 * which is why callers learned to hand-write `(async () => { ... })()` — a
 * workaround documented as a gotcha rather than a bug.
 *
 * `runnable()` below actually EXECUTES the wrapped code against a fake `figma`,
 * so these tests prove the result runs and returns the right value, not just
 * that it looks plausible.
 */
const runnable = async (code, figma) => {
  const wrapped = wrapCodeIfNeeded(code);
  // eslint-disable-next-line no-new-func
  const fn = new Function('figma', `return (${wrapped});`);
  return await fn(figma);
};

const fakeFigma = () => ({
  root: { name: 'My File' },
  currentPage: { name: 'Page 1', children: [{ name: 'a' }, { name: 'b' }] },
  getNodeByIdAsync: async (id) => (id === '1:2' ? { id, name: 'Found' } : null),
});

describe('wrapCodeIfNeeded — shapes that used to fail', () => {
  it('top-level await returns its value (was: "await is only valid in async functions")', async () => {
    const out = await runnable(`await figma.getNodeByIdAsync('1:2')`, fakeFigma());
    assert.deepStrictEqual(out, { id: '1:2', name: 'Found' });
  });

  it('top-level await inside a statement list', async () => {
    const out = await runnable(
      `const n = await figma.getNodeByIdAsync('1:2');\nreturn n.name;`,
      fakeFigma()
    );
    assert.strictEqual(out, 'Found');
  });

  it('return with no semicolon before it (was: "Illegal return statement")', async () => {
    const out = await runnable(`let p = 41\nreturn p + 1`, fakeFigma());
    assert.strictEqual(out, 42);
  });

  it('return inside an if at top level (was: "Illegal return statement")', async () => {
    const out = await runnable(
      `const p = figma.currentPage;\nif (!p) { return 'none' }\nreturn p.name;`,
      fakeFigma()
    );
    assert.strictEqual(out, 'Page 1');
  });

  it('a for-of loop with an await in the body', async () => {
    const out = await runnable(
      `const names = [];\nfor (const id of ['1:2','9:9']) { const n = await figma.getNodeByIdAsync(id); names.push(n ? n.name : 'missing'); }\nreturn names.join(',');`,
      fakeFigma()
    );
    assert.strictEqual(out, 'Found,missing');
  });
});

describe('wrapCodeIfNeeded — shapes that already worked keep working', () => {
  it('a bare expression evaluates to its value, not undefined', async () => {
    assert.strictEqual(await runnable(`figma.root.name`, fakeFigma()), 'My File');
  });

  it('a property chain with a call', async () => {
    assert.strictEqual(
      await runnable(`figma.currentPage.children.map(c => c.name).join('+')`, fakeFigma()),
      'a+b'
    );
  });

  it('an object literal is an object, not a block', async () => {
    assert.deepStrictEqual(await runnable(`({ a: 1 })`, fakeFigma()), { a: 1 });
  });

  it('a plain statement list without return yields undefined', async () => {
    assert.strictEqual(await runnable(`const a = 1; const b = 2;`, fakeFigma()), undefined);
  });

  it('a top-level return', async () => {
    assert.strictEqual(await runnable(`return 7;`, fakeFigma()), 7);
  });
});

describe('wrapCodeIfNeeded — already-wrapped code is left alone', () => {
  const untouched = [
    `(async () => { return 1; })()`,
    `(async function () { return 1; })()`,
    `(function () { return 1; })()`,
    `(() => 1)()`,
    `(x => x)(1)`,
  ];

  for (const code of untouched) {
    it(`does not re-wrap ${code}`, () => {
      assert.strictEqual(wrapCodeIfNeeded(code), code);
    });
  }

  it('an already-wrapped IIFE still produces its value', async () => {
    assert.strictEqual(await runnable(`(async () => { return 5; })()`, fakeFigma()), 5);
  });
});

describe('wrapCodeIfNeeded — edges', () => {
  it('passes malformed code through so Figma reports the real error', () => {
    const broken = `const = ;`;
    assert.strictEqual(wrapCodeIfNeeded(broken), broken);
  });

  it('leaves empty input alone', () => {
    assert.strictEqual(wrapCodeIfNeeded(''), '');
    assert.strictEqual(wrapCodeIfNeeded('   '), '   ');
  });

  it('does not execute anything while deciding', () => {
    let fired = false;
    globalThis.__wrapProbe = () => { fired = true; };
    wrapCodeIfNeeded('__wrapProbe()');
    delete globalThis.__wrapProbe;
    assert.strictEqual(fired, false, 'deciding must be parse-only');
  });

  it('a string containing "return" is still just an expression', async () => {
    assert.strictEqual(await runnable(`'return me'`, fakeFigma()), 'return me');
  });
});
