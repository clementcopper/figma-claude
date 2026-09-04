import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// `init` tells agents "treat non-zero as not done", and `render '<Frame bad>' && echo ok`
// printed ok: the failure went to stdout in red and the process exited 0. The same in every
// `spinner.fail(...)` of motion.js and in the eval/run error printer. A line that reports a
// failure must also set the exit code — on the same line or within the next three, so a
// reader sees both at once.

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'commands');
const REPORTS_FAILURE = /\b\w+\.fail\(|console\.(log|error)\(chalk\.red\('✗/;
const SETS_EXIT = /process\.exitCode = 1|process\.exit\(1\)|printEvalError\(/;

describe('a reported failure sets the exit code', () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    it(file, () => {
      const lines = readFileSync(join(dir, file), 'utf8').split('\n');
      const silent = lines
        .map((l, i) => (REPORTS_FAILURE.test(l) && !SETS_EXIT.test(lines.slice(i, i + 4).join('\n')) ? `${i + 1}: ${l.trim().slice(0, 90)}` : null))
        .filter(Boolean);
      assert.deepStrictEqual(silent, [], 'append `process.exitCode = 1;` to each');
    });
  }
});
