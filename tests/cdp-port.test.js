import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('getCdpPort', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.FIGMA_PORT;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FIGMA_PORT;
    } else {
      process.env.FIGMA_PORT = originalEnv;
    }
  });

  it('returns 9222 by default', async () => {
    delete process.env.FIGMA_PORT;
    const mod = await import(`../src/figma-patch.js?t=${Date.now()}`);
    assert.equal(mod.getCdpPort(), 9222);
  });

  it('returns FIGMA_PORT when set', async () => {
    process.env.FIGMA_PORT = '9333';
    const { getCdpPort } = await import(`../src/figma-patch.js?t=${Date.now()}`);
    assert.equal(getCdpPort(), 9333);
  });

  it('ignores invalid FIGMA_PORT values', async () => {
    process.env.FIGMA_PORT = 'abc';
    const { getCdpPort } = await import(`../src/figma-patch.js?t=${Date.now()}`);
    assert.equal(getCdpPort(), 9222);
  });
});

describe('parseCdpPort', () => {
  // `--port abc` used to fall back to 9222 without a word, and `9333abc` became 9333.
  it('accepts a whole number in range', async () => {
    const { parseCdpPort } = await import(`../src/figma-patch.js?t=${Date.now()}`);
    assert.equal(parseCdpPort('9333'), 9333);
    assert.equal(parseCdpPort(9222), 9222);
  });

  it('returns null for anything else', async () => {
    const { parseCdpPort } = await import(`../src/figma-patch.js?t=${Date.now()}`);
    for (const bad of ['abc', '9333abc', '0', '70000', '', undefined, '12.5']) {
      assert.equal(parseCdpPort(bad), null, `"${bad}" should be rejected`);
    }
  });
});
