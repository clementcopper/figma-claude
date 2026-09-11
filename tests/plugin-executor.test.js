import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { wrapCodeIfNeeded } from '../src/lib/eval-wrap.js';

/**
 * Safe Mode runs `eval` code inside the plugin's main thread (plugin/code.js), not through
 * CDP. The two paths must accept the same code: the CDP wrapper (src/lib/eval-wrap.js) asks
 * the engine which wrapper compiles, and for eight weeks the plugin kept guessing with
 * `lastIndexOf(';')` — four ordinary shapes were a SyntaxError in Safe Mode only, and nothing
 * ran plugin/code.js in Node, so no test saw it.
 *
 * plugin/code.js is a plain script with no imports; it loads as an ES module once `figma`
 * and `__html__` exist as globals. The tests below drive `figma.ui.onmessage` exactly as the
 * UI iframe does and read the `result` message the main thread posts back.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const posted = [];
const stubFigma = () => ({
  root: { name: 'My File' },
  currentPage: { name: 'Page 1', children: [{ name: 'a' }, { name: 'b' }] },
  getNodeByIdAsync: async (id) => (id === '1:2' ? { id, name: 'Found' } : null),
  showUI() {},
  on() {},
  notify() {},
  clientStorage: { getAsync: async () => null, setAsync: async () => {} },
  ui: {
    onmessage: null,
    postMessage(msg) {
      // Figma's postMessage rejects values that cannot be structured-cloned (a SceneNode);
      // the stub does the same for a marker so the plugin's handling of it is under test.
      if (msg.result && msg.result.__node) throw new Error('Cannot clone a node');
      posted.push(msg);
    },
  },
});

let nextId = 0;
/** Send one eval to the plugin main thread and return the `result` message for it. */
async function runInPlugin(code, timeoutMs) {
  const id = ++nextId;
  await globalThis.figma.ui.onmessage({ type: 'eval', id, code, timeoutMs });
  const msg = posted.find((m) => m.type === 'result' && m.id === id);
  assert.ok(msg, `plugin posted a result for id ${id}`);
  return msg;
}

/** The CDP path for the same code: wrap, then execute against the same fake. */
async function runViaCdp(code) {
  // eslint-disable-next-line no-new-func
  const fn = new Function('figma', `return (${wrapCodeIfNeeded(code)});`);
  return await fn(globalThis.figma);
}

before(async () => {
  globalThis.figma = stubFigma();
  globalThis.__html__ = '';
  const origLog = console.log;
  console.log = () => {};                 // the plugin prints one "started" line
  try { await import('../plugin/code.js'); } finally { console.log = origLog; }
  assert.equal(typeof globalThis.figma.ui.onmessage, 'function', 'plugin installed its onmessage');
});

// The shapes tests/eval-wrap.test.js proves for CDP, with their values.
const SHAPES = [
  [`await figma.getNodeByIdAsync('1:2')`, { id: '1:2', name: 'Found' }],
  [`const n = await figma.getNodeByIdAsync('1:2');\nreturn n.name;`, 'Found'],
  [`let p = 41\nreturn p + 1`, 42],
  [`const p = figma.currentPage;\nif (!p) { return 'none' }\nreturn p.name;`, 'Page 1'],
  [`const names = [];\nfor (const id of ['1:2','9:9']) { const n = await figma.getNodeByIdAsync(id); names.push(n ? n.name : 'missing'); }\nreturn names.join(',');`, 'Found,missing'],
  [`figma.root.name`, 'My File'],
  [`figma.currentPage.children.map(c => c.name)`, ['a', 'b']],
  [`({ a: 1 })`, { a: 1 }],
  [`const a = 1; const b = 2;`, undefined],
  [`const a = 1; const b = 2`, undefined],
  [`return 7;`, 7],
  [`'return me'`, 'return me'],
  [`if (figma.currentPage) { figma.notify('x') }`, undefined],
  [`const x = 1; if (x) { figma.notify('a') }`, undefined],
  [`(async () => { return 5; })()`, 5],
];

describe('plugin/code.js executes the shapes the CDP path accepts', () => {
  for (const [code, expected] of SHAPES) {
    it(JSON.stringify(code), async () => {
      const msg = await runInPlugin(code);
      assert.strictEqual(msg.error, undefined, `plugin reported: ${msg.error}`);
      assert.deepStrictEqual(msg.result, expected);
    });
  }

  it('agrees with wrapCodeIfNeeded on every shape', async () => {
    for (const [code] of SHAPES) {
      const viaCdp = await runViaCdp(code);
      const viaPlugin = await runInPlugin(code);
      assert.deepStrictEqual(viaPlugin.result, viaCdp, `differs for ${JSON.stringify(code)}`);
    }
  });
});

describe('plugin/code.js errors', () => {
  it('a thrown Error arrives as its message', async () => {
    const msg = await runInPlugin(`throw new Error('boom')`);
    assert.strictEqual(msg.error, 'boom');
  });

  it('a thrown non-Error arrives as text, not as a silent success', async () => {
    const msg = await runInPlugin(`throw 'plain string'`);
    assert.strictEqual(msg.error, 'plain string');
    assert.strictEqual('result' in msg && msg.result !== undefined, false);
  });

  it('a syntax error names the problem', async () => {
    const msg = await runInPlugin(`const = ;`);
    assert.match(String(msg.error), /unexpected|syntax/i);
  });

  it('a result that cannot be posted arrives as an error', async () => {
    const msg = await runInPlugin(`({ __node: true })`);
    assert.match(String(msg.error), /clone/i);
  });

  it('deciding the wrapper is parse-only: nothing runs twice', async () => {
    let fired = 0;
    globalThis.__pluginProbe = () => { fired++; return 'once'; };
    try {
      const msg = await runInPlugin(`__pluginProbe()`);
      assert.strictEqual(msg.result, 'once');
      assert.strictEqual(fired, 1, 'the probe ran exactly once (not during wrapper selection)');
    } finally {
      delete globalThis.__pluginProbe;
    }
  });
});

describe('plugin/code.js timeout', () => {
  it('uses the budget the message carries', async () => {
    const msg = await runInPlugin(`await new Promise(r => setTimeout(r, 300))`, 50);
    assert.match(String(msg.error), /timeout \(0\.05s\)/);
  });

  it('a string budget still counts', async () => {
    const msg = await runInPlugin(`await new Promise(r => setTimeout(r, 300))`, '50');
    assert.match(String(msg.error), /timeout \(0\.05s\)/);
  });

  it('a finished eval leaves no timer behind', async () => {
    // A live 90 s timer would keep the Node process alive and show up here as a handle.
    const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    await runInPlugin(`1 + 1`);
    const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    assert.strictEqual(after, before, 'eval must clear its timeout when the code finishes');
  });
});

describe('plugin/ui.html forwards what the daemon sends', () => {
  const ui = readFileSync(join(ROOT, 'plugin', 'ui.html'), 'utf8');

  it('the eval message carries timeoutMs to the main thread', () => {
    // The daemon sends { action: 'eval', id, code, timeoutMs }; the iframe relays it as
    // { type: 'eval', ... }. Dropping timeoutMs here made every Safe Mode eval a 90 s one.
    const m = ui.match(/pluginMessage:\s*\{\s*type:\s*'eval'[^}]*\}/);
    assert.ok(m, 'ui.html relays an eval message');
    assert.match(m[0], /timeoutMs:\s*msg\.timeoutMs/, 'relay must include timeoutMs');
  });
});
