import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Figma validates every networkAccess.allowedDomains entry as a URL and refuses the plugin
// import otherwise. Two things it is strict about, both learned from a rejected import
// ("'ws://127.0.0.1:3456' must be a valid URL"): the scheme must be one it permits, and the
// host must be `localhost` — an IP literal like 127.0.0.1 is refused. And the ports the plugin
// actually dials (ui.html) must all be allowed, or the socket that lands is blocked.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'plugin', 'manifest.json'), 'utf8'));
const ui = readFileSync(join(ROOT, 'plugin', 'ui.html'), 'utf8');

test('every allowedDomains entry is a valid ws/wss URL on localhost', () => {
  const domains = manifest.networkAccess.allowedDomains;
  assert.ok(Array.isArray(domains) && domains.length > 0, 'allowedDomains is a non-empty array');
  for (const d of domains) {
    // Figma refuses a raw IP literal; localhost is the only host form its examples show.
    assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(d), `${d} uses an IP literal — Figma refuses it, use localhost`);
    let url;
    assert.doesNotThrow(() => { url = new URL(d); }, `${d} must be a valid URL`);
    assert.match(url.protocol, /^wss?:$/, `${d} must be ws:// or wss://`);
    assert.equal(url.hostname, 'localhost', `${d} must be on localhost`);
  }
});

test('the ports ui.html dials are all in allowedDomains', () => {
  // The port list the plugin scans, e.g. `const PORTS = [3456, 3457, ...]`.
  const m = ui.match(/const PORTS\s*=\s*\[([0-9,\s]+)\]/);
  assert.ok(m, 'ui.html declares a PORTS array');
  const ports = m[1].split(',').map((n) => n.trim()).filter(Boolean);
  const allowed = new Set(manifest.networkAccess.allowedDomains.map((d) => new URL(d).port));
  for (const p of ports) {
    assert.ok(allowed.has(p), `ui.html dials ws://localhost:${p} but the manifest does not allow it`);
  }
  // And ui.html connects to localhost, matching the manifest host.
  assert.match(ui, /ws:\/\/localhost:\$\{port\}/, 'ui.html must dial ws://localhost:${port}');
  assert.doesNotMatch(ui, /ws:\/\/127\.0\.0\.1/, 'ui.html must not dial the IP literal Figma refuses');
});
