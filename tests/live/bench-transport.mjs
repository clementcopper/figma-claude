#!/usr/bin/env node
// LIVE: times the daemon's eval path in whatever mode the daemon is in. Reads the open file
// (page walk, one PNG export of the first top-level node), creates and deletes nothing.
//
//   npm run bench:transport            # once with `connect` (Yolo), once with `connect --safe`
//   BENCH_RUNS=50 npm run bench:transport
//
// Why: REFERENCE.md claimed Yolo is "~10x faster" than Safe Mode with nothing measured behind
// it. Each number here is one end-to-end CLI request: HTTP → daemon → (CDP | plugin) → back.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = process.env.DAEMON_PORT || 3456;
const RUNS = Number(process.env.BENCH_RUNS) || 20;
const TOKEN = readFileSync(join(homedir(), '.figma-ds-cli', '.daemon-token'), 'utf8').trim();
const headers = { 'X-Daemon-Token': TOKEN, 'Content-Type': 'application/json' };

const health = await (await fetch(`http://127.0.0.1:${PORT}/health`, { headers })).json();
if (health.status !== 'ok') { console.error('daemon not connected:', health); process.exit(1); }
const mode = health.plugin && !health.cdp ? 'safe (plugin)' : `cdp (${health.mode})`;

async function evalOnce(code) {
  const t0 = performance.now();
  const res = await fetch(`http://127.0.0.1:${PORT}/exec`, { method: 'POST', headers, body: JSON.stringify({ action: 'eval', code, timeoutMs: 90000 }) });
  const body = await res.json();
  if (body.error) throw new Error(body.error);
  return { ms: performance.now() - t0, bytes: JSON.stringify(body).length, result: body.result };
}

// The first two cases are document-independent, so they compare cleanly across modes even
// when each mode has a different file loaded:
//   - `1 + 1` is the pure round-trip: HTTP -> daemon -> (CDP over port | CDP over pipe |
//     plugin iframe + main thread) -> back. This is THE per-call transport-overhead number.
//   - the 100 KB byte array is the shape every image export takes (Array.from(bytes)), so it
//     exercises Safe Mode's known cost — the payload is JSON-serialised on the plugin's main
//     thread, again in the iframe, then once more by the daemon; Yolo/Pipe serialise once.
// The last two depend on the open document, so read them per row against the reported file.
const cases = {
  'trivial (1+1) — pure round-trip': '1 + 1',
  '100 KB byte array — export-shaped payload': 'Array.from(new Uint8Array(100 * 1024))',
  'page walk (findAll count) [doc-dependent]': 'figma.currentPage.findAll(() => true).length',
  'PNG export 512px, first node [doc-dependent]': `(async () => {
    const n = figma.currentPage.children[0];
    if (!n) return null;
    const bytes = await n.exportAsync({ format: 'PNG', constraint: { type: 'WIDTH', value: 512 } });
    return Array.from(bytes);
  })()`,
};

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

console.log(`mode: ${mode}   file: ${health.file || '?'}   runs: ${RUNS}\n`);
console.log('case'.padEnd(42), 'median'.padStart(9), 'p95'.padStart(9), 'min'.padStart(9), 'payload'.padStart(10));
for (const [name, code] of Object.entries(cases)) {
  try { await evalOnce(code); } catch (e) { console.log(name.padEnd(42), 'skipped:', e.message); continue; } // warm-up
  const times = []; let bytes = 0;
  for (let i = 0; i < RUNS; i++) { const r = await evalOnce(code); times.push(r.ms); bytes = r.bytes; }
  console.log(name.padEnd(42), `${pct(times, 0.5).toFixed(1)} ms`.padStart(9), `${pct(times, 0.95).toFixed(1)} ms`.padStart(9), `${Math.min(...times).toFixed(1)} ms`.padStart(9), `${(bytes / 1024).toFixed(0)} KB`.padStart(10));
}
