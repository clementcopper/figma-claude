import { describe, it } from 'node:test';
import assert from 'node:assert';
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
