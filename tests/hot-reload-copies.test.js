import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyOwnerPid, staleClientCopies, processExists } from '../src/lib/hot-reload-copies.js';

describe('copyOwnerPid', () => {
  it('reads the pid from a hot-reload copy name', () => {
    assert.equal(copyOwnerPid('.figma-client-1789111516026.468.33653.mjs'), 33653);
    assert.equal(copyOwnerPid('.figma-client-1788541255912.0464.mjs'), 464);
  });

  it('ignores everything that is not a copy', () => {
    for (const name of ['figma-client.js', 'daemon.js', '.figma-client-x.mjs', '.figma-client-1.2.mjs.bak']) {
      assert.equal(copyOwnerPid(name), null, name);
    }
  });
});

describe('staleClientCopies', () => {
  const names = [
    'figma-client.js',
    '.figma-client-1789111516026.468.33653.mjs',   // owner dead
    '.figma-client-1789111516026.468.75837.mjs',   // owner alive
    '.figma-client-1788541255912.0464.mjs',        // owner dead
  ];
  const alive = new Set([75837]);

  it('names the copies whose owner is gone and nothing else', () => {
    assert.deepEqual(staleClientCopies(names, (pid) => alive.has(pid)), [
      '.figma-client-1789111516026.468.33653.mjs',
      '.figma-client-1788541255912.0464.mjs',
    ]);
  });

  it('keeps every copy while all owners live', () => {
    assert.deepEqual(staleClientCopies(names, () => true), []);
  });
});

describe('processExists', () => {
  it('sees this process and not a pid nobody has', () => {
    assert.equal(processExists(process.pid), true);
    // pid 1 is launchd/init: exists, owned by root — EPERM must read as alive.
    assert.equal(processExists(1), true);
    // The highest pids macOS and Linux hand out stay far below this.
    assert.equal(processExists(2 ** 22 - 1), false);
  });
});
