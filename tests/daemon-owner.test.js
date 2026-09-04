import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isOurDaemon } from '../src/lib/daemon-owner.js';

// `daemon stop` and `daemon restart` ran `lsof -ti:3456 | xargs kill -9`: whatever held the
// port died, including a dev server that had nothing to do with figma-cli.

describe('isOurDaemon', () => {
  it('recognises the daemon by its script', () => {
    assert.strictEqual(isOurDaemon('node /Users/x/figma-cli/src/daemon.js'), true);
    assert.strictEqual(isOurDaemon('/usr/local/bin/node /opt/figma-cli/src/daemon.js'), true);
  });

  it('refuses anything else, including nothing', () => {
    assert.strictEqual(isOurDaemon('node server.js --port 3456'), false);
    assert.strictEqual(isOurDaemon('python3 -m http.server 3456'), false);
    assert.strictEqual(isOurDaemon(''), false);
    assert.strictEqual(isOurDaemon(null), false);
  });
});
