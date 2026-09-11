import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shouldFallBackToDirect } from '../src/lib/cli-core.js';

// `fastEval` caught every daemon error and re-ran the same code over a direct CDP connection.
// When the daemon had executed the code and then reported an error (or timed out mid-run),
// the second run created every node twice. `figmaEvalSync` guards this with `fromDaemon`;
// `fastEval` did not.

describe('shouldFallBackToDirect', () => {
  it('falls back only when the daemon never answered', () => {
    const unreachable = new TypeError('fetch failed');
    assert.strictEqual(shouldFallBackToDirect(unreachable), true);
  });

  it('never falls back on an error the daemon reported, or on a timeout', () => {
    const reported = Object.assign(new Error('ReferenceError: x is not defined'), { fromDaemon: true });
    assert.strictEqual(shouldFallBackToDirect(reported), false);
    const timedOut = Object.assign(new Error('Execution timeout (90s)'), { fromDaemon: true });
    assert.strictEqual(shouldFallBackToDirect(timedOut), false);
  });
});

describe('the eval command makes the same decision', () => {
  // `eval` had its own classifier: any message containing "timeout" was a connection error,
  // so a daemon-reported `Execution timeout (2s)` — code still running in Figma — went to the
  // sync path and ran the code a second time; in Safe Mode that came back as "no value
  // returned", exit 0, 8 s after a 2 s budget (live, 2026-09-11). One decision, one function.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'commands', 'export-eval.js'), 'utf8');
  const evalAction = src.slice(src.indexOf(".command('eval"), src.indexOf(".command('run"));

  it('consults shouldFallBackToDirect before the sync path', () => {
    assert.match(evalAction, /shouldFallBackToDirect\(e\)/);
  });

  it('does not classify daemon errors by message text', () => {
    assert.doesNotMatch(evalAction, /includes\('timeout'\)/);
    assert.doesNotMatch(evalAction, /isConnectionError/);
  });
});
