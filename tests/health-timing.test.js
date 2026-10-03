import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HEALTH_CURL_TIMEOUT_MS } from '../src/lib/cli-core.js';
import { PROBE_TIMEOUT_MS } from '../src/lib/cdp-health.js';

// Two ends of one path: the daemon's /health may spend PROBE_TIMEOUT_MS asking Figma, and the
// CLI's isDaemonRunning() waits for /health with its own curl timeout. The CLI's used to be
// 1000 ms against a 2000 ms probe, so a daemon that was merely waiting on a busy renderer read
// as absent, and `eval` went to a port that Pipe Mode never opens (FEEDBACK.md, 28 Sep 2026).

test('the CLI waits longer for /health than the daemon may spend probing', () => {
  assert.ok(HEALTH_CURL_TIMEOUT_MS >= PROBE_TIMEOUT_MS + 1000, `${HEALTH_CURL_TIMEOUT_MS} vs probe ${PROBE_TIMEOUT_MS}`);
});

test('the daemon probes with the exported constant, not a literal', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'daemon.js'), 'utf8');
  assert.match(src, /probeCdpClient\(cdpClient, \{ timeoutMs: PROBE_TIMEOUT_MS \}\)/);
  assert.doesNotMatch(src, /probeCdpClient\(cdpClient, \{ timeoutMs: \d+ \}\)/);
});
