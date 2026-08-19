import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'src', 'index.js');
function run(args, opts = {}) {
  return execFileSync('node', [CLI, ...args], { encoding: 'utf8', ...opts });
}
// TWO gates, not one. This test BUILDS a component set in whatever file the daemon is bound to —
// the user's open document — and `extract` walks every page of it. A connected Figma must
// therefore never be enough to unlock it: without FIGMA_LIVE=1 it stays skipped, so `npm test`
// is Figma-free even on a machine that happens to have a live connection.
const OPTED_IN = process.env.FIGMA_LIVE === '1';

// Second gate: a real round-trip. When Figma is not connected the CLI exits 1 → execFileSync
// throws → we skip.
function figmaReady() {
  if (!OPTED_IN) return false;
  try { return /ok/.test(run(['eval', `(async () => 'ok')()`])); } catch { return false; }
}

// eval source that creates a 2-variant "Button" COMPONENT_SET and returns its id.
const BUILD_SET = `(async () => {
  const mk = (name) => { const c = figma.createComponent(); c.name = name; c.resize(80, 40); return c; };
  const a = mk('Size=Small'); const b = mk('Size=Large');
  const set = figma.combineAsVariants([a, b], figma.currentPage);
  set.name = 'Button';
  return JSON.stringify({ id: set.id });
})()`;

const cleanup = (id) => `(async () => {
  const n = await figma.getNodeByIdAsync(${JSON.stringify(id)});
  if (n) n.remove();
  return 'ok';
})()`;

test('extract → instantiate roundtrip (opt-in: FIGMA_LIVE=1 plus a connected Figma)', { skip: !figmaReady() }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'inst-'));
  const md = join(dir, 'DESIGN.md');
  let setId;
  let instanceIds = [];
  try {
    const built = JSON.parse(run(['eval', BUILD_SET]).trim().split('\n').pop());
    setId = built.id;

    run(['extract', md]);
    const text = readFileSync(md, 'utf8');
    assert.match(text, /### Button/);
    assert.match(text, /Reuse: import existing/);

    const out = run(['instantiate', 'Button', '--file', md]);
    assert.match(out, /Instanced "Button" via (key|id)/);

    // `instantiate` leaves its instance selected. Remember it BY ID: deleting "whatever is
    // selected" during cleanup would take the user's own selection with it.
    instanceIds = JSON.parse(
      run(['eval', `(async () => JSON.stringify(figma.currentPage.selection.map(n => n.id)))()`])
        .trim().split('\n').pop()
    );
  } finally {
    // Only the ids this test created — never a search, never the selection.
    for (const id of [...instanceIds, setId].filter(Boolean)) {
      try { run(['eval', cleanup(id)]); } catch {}
    }
  }
});
