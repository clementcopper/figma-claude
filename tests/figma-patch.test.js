import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { patchAsarFile, unpatchAsarFile, appPathFromAsar } from '../src/figma-patch.js';

// The patch read app.asar whole and wrote it back in place: an interrupted write left a
// truncated archive and Figma would not start, with nothing to restore from. Unpatch skipped
// the write-access check and codesign targeted /Applications/Figma.app whatever getAsarPath
// said. Everything below runs on a fake archive in a temp dir — never on the real app.

const BLOCK = 'removeSwitch("remote-debugging-port")';
const PATCHED = 'removeSwitch("remote-debugXing-port")';

function fakeAsar(content) {
  const dir = mkdtempSync(join(tmpdir(), 'figma-patch-test-'));
  const asar = join(dir, 'app.asar');
  writeFileSync(asar, Buffer.concat([Buffer.from('HEADER'), Buffer.from(content), Buffer.from('TRAILER')]));
  return { dir, asar };
}

describe('patchAsarFile / unpatchAsarFile', () => {
  it('replaces the block string, leaves no temp file, and reverses', () => {
    const { dir, asar } = fakeAsar(BLOCK);
    try {
      assert.strictEqual(patchAsarFile(asar), true);
      assert.ok(readFileSync(asar, 'latin1').includes(PATCHED));
      assert.deepStrictEqual(readdirSync(dir), ['app.asar'], 'no temp file left behind');
      assert.strictEqual(unpatchAsarFile(asar), true);
      assert.ok(readFileSync(asar, 'latin1').includes(BLOCK));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('is idempotent and names an unknown layout', () => {
    const { dir, asar } = fakeAsar(PATCHED);
    try {
      assert.strictEqual(patchAsarFile(asar), true, 'already patched is fine');
      writeFileSync(asar, 'something else entirely');
      assert.throws(() => patchAsarFile(asar), /Figma version|incompatible|unknown/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('leaves the original untouched when the write cannot land', () => {
    const { dir, asar } = fakeAsar(BLOCK);
    try {
      chmodSync(dir, 0o500); // no new files in the directory → the temp file cannot be created
      assert.throws(() => patchAsarFile(asar));
      chmodSync(dir, 0o700);
      assert.ok(readFileSync(asar, 'latin1').includes(BLOCK), 'original bytes intact');
      assert.deepStrictEqual(readdirSync(dir), ['app.asar']);
    } finally { chmodSync(dir, 0o700); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('appPathFromAsar', () => {
  it('walks from Contents/Resources/app.asar up to the .app bundle', () => {
    assert.strictEqual(appPathFromAsar('/Applications/Figma.app/Contents/Resources/app.asar'), '/Applications/Figma.app');
    assert.strictEqual(appPathFromAsar('/Users/x/Applications/Figma Beta.app/Contents/Resources/app.asar'), '/Users/x/Applications/Figma Beta.app');
  });
});
