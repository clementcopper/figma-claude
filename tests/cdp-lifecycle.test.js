import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FigmaClient } from '../src/figma-client.js';

// The CDP client resolved a protocol error as a successful `undefined`, `send()` could never
// settle once the socket went away, and `close()` left pending callers hanging.

describe('FigmaClient.eval', () => {
  it('throws on a CDP protocol error instead of returning undefined', async () => {
    const client = new FigmaClient();
    client.ws = { readyState: 1 };
    client.send = async () => ({ id: 7, error: { code: -32000, message: 'Cannot find context with specified id' } });
    await assert.rejects(client.eval('1+1'), /Cannot find context/);
  });
});

describe('FigmaClient.send', () => {
  it('rejects after its timeout when no answer arrives', async () => {
    const client = new FigmaClient();
    client.ws = { readyState: 1, send() {} };
    await assert.rejects(client.send('Runtime.evaluate', {}, { timeoutMs: 20 }), /timed out/i);
    assert.strictEqual(client.callbacks.size, 0, 'the callback is dropped with the request');
  });

  it('rejects when the socket is not open', async () => {
    const client = new FigmaClient();
    client.ws = { readyState: 3, send() {} };
    await assert.rejects(client.send('Runtime.evaluate', {}), /not open|not connected/i);
  });
});

describe('FigmaClient.close', () => {
  it('rejects every pending request', async () => {
    const client = new FigmaClient();
    client.ws = { readyState: 1, send() {}, close() {} };
    const pending = client.send('Runtime.evaluate', {}, { timeoutMs: 5000 });
    client.close();
    await assert.rejects(pending, /closed/i);
    assert.strictEqual(client.ws, null);
  });
});
