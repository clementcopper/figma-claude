import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// A truncated ~/.figma-cli/plugins/<name>/plugin.json (an interrupted install) threw from
// JSON.parse at module load, so `figma-cli --help` and every unknown command died before
// printing anything, with no hint which file.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('getInstalledPlugins', () => {
  it('skips a plugin whose plugin.json is corrupt, and names it', () => {
    const home = mkdtempSync(join(tmpdir(), 'figma-cli-home-'));
    try {
      mkdirSync(join(home, '.figma-cli', 'plugins', 'broken'), { recursive: true });
      writeFileSync(join(home, '.figma-cli', 'plugins', 'broken', 'plugin.json'), '{"name": "broken", "vers');
      mkdirSync(join(home, '.figma-cli', 'plugins', 'fine'), { recursive: true });
      writeFileSync(join(home, '.figma-cli', 'plugins', 'fine', 'plugin.json'), '{"name": "fine", "version": "1.0.0"}');
      const out = execFileSync(process.execPath, ['--input-type=module', '-e',
        "const { getInstalledPlugins } = await import('./src/plugins.js'); console.log(JSON.stringify(getInstalledPlugins().map(p => p.name)));"],
        { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      assert.deepStrictEqual(JSON.parse(out.trim().split('\n').pop()), ['fine']);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
