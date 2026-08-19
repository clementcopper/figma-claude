import { describe, it } from 'node:test';
import assert from 'node:assert';
import { shimDir, shimPath, shimScript, pathWithShim } from '../dist/lib/cli-shim.mjs';

describe('shim paths', () => {
  it('sits next to the CLI\'s own state', () => {
    assert.strictEqual(shimDir('/Users/x'), '/Users/x/.figma-ds-cli/bin');
    assert.strictEqual(shimPath('/Users/x'), '/Users/x/.figma-ds-cli/bin/figma-cli');
  });
});

describe('shimScript', () => {
  it('forwards every argument to the checkout', () => {
    const script = shimScript('/Users/x/figma-cli/src/index.js');
    assert.match(script, /^#!\/bin\/sh\n/);
    assert.match(script, /exec node '\/Users\/x\/figma-cli\/src\/index\.js' "\$@"/);
  });

  it('survives a path with a quote in it', () => {
    const script = shimScript("/Users/x/it's/src/index.js");
    assert.match(script, /'\/Users\/x\/it'\\''s\/src\/index\.js'/);
  });
});

describe('pathWithShim', () => {
  it('puts the shim first', () => {
    assert.strictEqual(pathWithShim('/usr/bin:/bin', '/shim'), '/shim:/usr/bin:/bin');
  });

  it('does not grow on a second start', () => {
    assert.strictEqual(pathWithShim('/shim:/usr/bin', '/shim'), '/shim:/usr/bin');
    assert.strictEqual(pathWithShim('/usr/bin:/shim:/bin', '/shim'), '/shim:/usr/bin:/bin');
  });
});
