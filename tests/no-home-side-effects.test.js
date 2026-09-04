import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Importing src/commands/misc.js ran `loadPlugins` → `getInstalledPlugins` → `ensurePluginsDir`,
// so `npm test` (and every `figma-cli --help`) created ~/.figma-cli/plugins/ in the user's home.
// Listing what is installed must not install a directory.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('loading the CLI', () => {
  it('creates nothing under HOME', () => {
    const home = mkdtempSync(join(tmpdir(), 'figma-cli-home-'));
    try {
      execFileSync(process.execPath, ['--input-type=module', '-e', "await import('./src/commands/misc.js'); process.exit(0);"], {
        cwd: ROOT, env: { ...process.env, HOME: home }, stdio: 'pipe',
      });
      assert.strictEqual(existsSync(join(home, '.figma-cli')), false, '~/.figma-cli was created just by loading modules');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
