import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('source rules', () => {
  it('setup does not shell out to a binary name that may not exist', () => {
    // `setup` ran `execSync('figma-ds-cli init')`: from a checkout, or an install that only
    // linked `figma-cli`, that is "command not found" and an unhandled throw.
    assert.doesNotMatch(read('src/commands/setup.js'), /execSync\(['"`]figma-ds-cli/);
  });

  it('figma-client uses no synchronous node lookup', () => {
    // `figma.getNodeById` throws under documentAccess: dynamic-page; 50 call sites had it,
    // 35 of them in methods nothing called, 14 in methods that are used.
    const hits = read('src/figma-client.js').split('\n').map((l, i) => (/figma\.getNodeById\(/.test(l) ? i + 1 : null)).filter(Boolean);
    assert.deepStrictEqual(hits, [], `sync getNodeById at line(s) ${hits.join(', ')}`);
  });

  it('every createText() in figma-client sets fontName before characters', () => {
    // `organizeVariants` loaded Inter Medium and wrote `characters` on a node still set to
    // Inter Regular — "Cannot write to node with unloaded font".
    const src = read('src/figma-client.js');
    const re = /(\w+) = figma\.createText\(\);([\s\S]{0,400}?)\1\.characters =/g;
    const bad = [];
    let m;
    while ((m = re.exec(src)) !== null) {
      if (!new RegExp(`${m[1]}\\.fontName =`).test(m[2])) bad.push(src.slice(0, m.index).split('\n').length);
    }
    assert.deepStrictEqual(bad, [], `createText() without fontName before characters at line(s) ${bad.join(', ')}`);
  });
});
