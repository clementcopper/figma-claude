import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeCdpClient, serveCachedHealth, FIGMA_PROBE } from '../src/lib/cdp-health.js';

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

test('a positive verdict is cached for 30 s, a negative for 2', () => {
  // The 30 s cache over a negative is what turned one missed probe into half a minute of
  // "Not connected" after a long render had already finished (FEEDBACK.md, 11 Sep 2026).
  assert.equal(serveCachedHealth(true, 0), true);
  assert.equal(serveCachedHealth(true, 29999), true);
  assert.equal(serveCachedHealth(true, 30000), false);   // exactly on the boundary: probe again
  assert.equal(serveCachedHealth(false, 1999), true);
  assert.equal(serveCachedHealth(false, 2000), false);
  assert.equal(serveCachedHealth(false, 30000), false);
});

test('serveCachedHealth takes its own ttls and refuses a nonsense age', () => {
  assert.equal(serveCachedHealth(false, 500, { negativeTtlMs: 100 }), false);
  assert.equal(serveCachedHealth(true, 500, { positiveTtlMs: 100 }), false);
  assert.equal(serveCachedHealth(true, -1), false);
  assert.equal(serveCachedHealth(true, NaN), false);
});

test('while Figma runs code for this daemon, /health does not probe: a probe would wait behind it', async () => {
  // 2026-10-03: during a busy eval every /health took 2 s and answered cdp:false; the CLI's
  // 1 s curl timed out, `status` said "Not connected", and `eval` fell to the port path.
  const { probeWhileBusy, PROBE_TIMEOUT_MS } = await import('../src/lib/cdp-health.js');
  assert.equal(probeWhileBusy(1), 'healthy');
  assert.equal(probeWhileBusy(3), 'healthy');
  assert.equal(probeWhileBusy(0), null);
  assert.equal(PROBE_TIMEOUT_MS, 2000);
});
