import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// `checkConnection()` is async: it revives an idle daemon, then exits the process with the
// connect advice when nothing answers. Called bare, it starts and is left behind — the command
// body runs on, fails with a raw `spawnSync /bin/sh ETIMEDOUT`, and the check's exit fires
// later or not at all. 71 sites did this; `checkConnectionSync` existed for exactly them and
// had no caller.

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'commands');

describe('checkConnection is never called bare', () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    it(file, () => {
      const lines = readFileSync(join(dir, file), 'utf8').split('\n');
      const bare = lines
        .map((l, i) => (/^\s*checkConnection\(\);/.test(l) ? `${i + 1}: ${l.trim()}` : null))
        .filter(Boolean);
      assert.deepStrictEqual(bare, [], 'use `await checkConnection()` in an async action, `checkConnectionSync()` in a sync one');
    });
  }
});
