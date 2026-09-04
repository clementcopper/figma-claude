import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateHttpRequest, validateUpgrade } from '../src/lib/daemon-auth.js';

const TOKEN = 'a1b2c3d4e5f6';

describe('validateHttpRequest', () => {
  it('accepts a loopback host with the session token in the header', () => {
    assert.strictEqual(validateHttpRequest({ host: '127.0.0.1:3456', 'x-daemon-token': TOKEN }, TOKEN), null);
    assert.strictEqual(validateHttpRequest({ host: 'localhost:3456', 'x-daemon-token': TOKEN }, TOKEN), null);
  });

  it('rejects a foreign host (DNS rebinding)', () => {
    assert.match(validateHttpRequest({ host: 'evil.example:3456', 'x-daemon-token': TOKEN }, TOKEN), /host/i);
  });

  it('rejects a missing or wrong token, and everything when no token is configured', () => {
    assert.match(validateHttpRequest({ host: 'localhost' }, TOKEN), /token/i);
    assert.match(validateHttpRequest({ host: 'localhost', 'x-daemon-token': 'nope' }, TOKEN), /token/i);
    assert.match(validateHttpRequest({ host: 'localhost', 'x-daemon-token': TOKEN }, null), /token/i);
  });
});

describe('validateUpgrade (the /plugin WebSocket handshake)', () => {
  const ok = { headers: { host: '127.0.0.1:3456' }, url: `/plugin?token=${TOKEN}` };

  it('accepts the plugin: loopback host, token in the query, no Origin', () => {
    assert.strictEqual(validateUpgrade(ok, TOKEN), null);
  });

  it('accepts the opaque origin a sandboxed plugin iframe sends', () => {
    assert.strictEqual(validateUpgrade({ ...ok, headers: { ...ok.headers, origin: 'null' } }, TOKEN), null);
  });

  it('rejects a handshake without a token — the pre-fix behaviour let any process become the plugin', () => {
    assert.match(validateUpgrade({ ...ok, url: '/plugin' }, TOKEN), /token/i);
    assert.match(validateUpgrade({ ...ok, url: `/plugin?token=wrong` }, TOKEN), /token/i);
  });

  it('rejects a web page: any real Origin is cross-origin, even with the right token', () => {
    const fromPage = { ...ok, headers: { ...ok.headers, origin: 'https://evil.example' } };
    assert.match(validateUpgrade(fromPage, TOKEN), /origin/i);
  });

  it('rejects a foreign host and a path other than /plugin', () => {
    assert.match(validateUpgrade({ ...ok, headers: { host: 'evil.example' } }, TOKEN), /host/i);
    assert.match(validateUpgrade({ ...ok, url: `/other?token=${TOKEN}` }, TOKEN), /path/i);
  });

  it('also takes the token from the header, for non-browser clients', () => {
    assert.strictEqual(validateUpgrade({ headers: { host: 'localhost', 'x-daemon-token': TOKEN }, url: '/plugin' }, TOKEN), null);
  });
});
