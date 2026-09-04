import { describe, it } from 'node:test';
import assert from 'node:assert';
import { curlConfig, CURL_ARGS } from '../src/lib/daemon-curl.js';

// The sync daemon path shells out to curl. The token used to travel as `-H "X-Daemon-Token: …"`
// on the command line, where `ps` shows it to every local user for the length of the call —
// the very readers the token exists to keep out. A curl config on stdin (`-K -`) carries it
// without ever touching argv.

describe('curlConfig', () => {
  it('puts the token into the config, and the argv carries no header at all', () => {
    const cfg = curlConfig({ url: 'http://127.0.0.1:3456/health', token: 'abc123' });
    assert.match(cfg, /^header = "X-Daemon-Token: abc123"$/m);
    assert.deepStrictEqual(CURL_ARGS, ['-s', '-K', '-']);
  });

  it('spells a POST with a JSON body file', () => {
    const cfg = curlConfig({ url: 'http://127.0.0.1:3456/exec', token: 't', method: 'POST', dataFile: '/tmp/p.json' });
    assert.match(cfg, /^request = "POST"$/m);
    assert.match(cfg, /^header = "Content-Type: application\/json"$/m);
    assert.match(cfg, /^data = "@\/tmp\/p.json"$/m);
  });

  it('supports the status-code-only form', () => {
    const cfg = curlConfig({ url: 'http://127.0.0.1:3456/health', token: 't', output: '/dev/null', writeOut: '%{http_code}' });
    assert.match(cfg, /^output = "\/dev\/null"$/m);
    assert.match(cfg, /^write-out = "%\{http_code\}"$/m);
  });

  it('escapes quotes and backslashes so a value cannot add config lines', () => {
    const cfg = curlConfig({ url: 'http://x', token: 'a"b\\c' });
    assert.match(cfg, /header = "X-Daemon-Token: a\\"b\\\\c"/);
  });

  it('omits the header when there is no token', () => {
    assert.doesNotMatch(curlConfig({ url: 'http://x', token: null }), /X-Daemon-Token/);
  });
});
