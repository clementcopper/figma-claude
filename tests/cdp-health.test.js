import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeCdpClient, FIGMA_PROBE } from '../src/lib/cdp-health.js';

const client = (readyState, evalImpl) => ({ ws: { readyState }, eval: evalImpl });

test('a context that still has figma is healthy', async () => {
  let asked;
  const c = client(1, async (expr) => { asked = expr; return true; });
  assert.equal(await probeCdpClient(c), 'healthy');
  assert.equal(asked, FIGMA_PROBE);
});

test('an open socket whose context lost figma is no-figma, not healthy', async () => {
  // The case from 2026-09-16: Figma dropped its plugin realm in place, the session stayed open,
  // `1` still evaluated fine, and status said Connected while every command failed.
  assert.equal(await probeCdpClient(client(1, async () => false)), 'no-figma');
  assert.equal(await probeCdpClient(client(1, async () => undefined)), 'no-figma');
});

test('no client, a closed socket, a throwing or a hanging eval are dead', async () => {
  assert.equal(await probeCdpClient(null), 'dead');
  assert.equal(await probeCdpClient({ ws: null, eval: async () => true }), 'dead');
  assert.equal(await probeCdpClient(client(3, async () => true)), 'dead');
  assert.equal(await probeCdpClient(client(1, async () => { throw new Error('CDP connection closed'); })), 'dead');
  assert.equal(await probeCdpClient(client(1, () => new Promise(() => {})), { timeoutMs: 20 }), 'dead');
});
