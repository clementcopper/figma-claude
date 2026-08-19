import { describe, it } from 'node:test';
import assert from 'node:assert';
import { describePtyExit } from '../dist/lib/pty-exit.mjs';

const HINT = 'reinstalled while running';

describe('describePtyExit', () => {
  it('offers the one known cause when a terminal dies on startup', () => {
    // The observed case: install:app replaced the bundle under a running instance, and every
    // terminal opened afterwards died instantly with code 1 and no output.
    const text = describePtyExit({ code: 1, msSinceSpawn: 40, sawOutput: false });
    assert.match(text, /\[Process exited with code 1\]/);
    assert.ok(text.includes(HINT));
  });

  it('stays quiet for an ordinary failure that produced output', () => {
    const text = describePtyExit({ code: 1, msSinceSpawn: 30, sawOutput: true });
    assert.ok(!text.includes(HINT));
  });

  it('stays quiet for a session that ran for a while', () => {
    const text = describePtyExit({ code: 1, msSinceSpawn: 90_000, sawOutput: false });
    assert.ok(!text.includes(HINT));
  });

  it('stays quiet for every other exit code', () => {
    for (const code of [0, 2, 127, 130]) {
      const text = describePtyExit({ code, msSinceSpawn: 10, sawOutput: false });
      assert.ok(!text.includes(HINT), `code ${String(code)} should not blame the bundle`);
      assert.match(text, new RegExp(`code ${String(code)}`));
    }
  });
});
