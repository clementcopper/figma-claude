import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

// The daemon in Plugin Mode, on a free port, with a temp HOME for the token file: no Figma,
// no plugin, nothing of the user's touched. Each test is one of the daemon's own contracts.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'test-token-0123456789abcdef';

const freePort = () => new Promise((res) => {
  const srv = createServer().listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startDaemon({ idleMs = 60000 } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'figma-cli-daemon-test-'));
  mkdirSync(join(home, '.figma-ds-cli'), { recursive: true });
  writeFileSync(join(home, '.figma-ds-cli', '.daemon-token'), TOKEN);
  const port = await freePort();
  const child = spawn(process.execPath, [join(ROOT, 'src', 'daemon.js')], {
    env: { ...process.env, HOME: home, DAEMON_PORT: String(port), DAEMON_MODE: 'plugin', DAEMON_IDLE_TIMEOUT: String(idleMs) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${port}/health`, { headers: { 'X-Daemon-Token': TOKEN } }); break; } catch { await sleep(100); }
  }
  const stop = () => { try { child.kill('SIGTERM'); } catch {} rmSync(home, { recursive: true, force: true }); };
  const exited = new Promise((r) => child.on('exit', r));
  return { port, home, child, stop, exited, log: () => log };
}

const plugin = (port, query = `?token=${TOKEN}`) => new Promise((res, rej) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/plugin${query}`);
  ws.on('open', () => res(ws));
  ws.on('error', rej);
});

const pingPong = (ws) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('no pong')), 2000);
  ws.once('message', (d) => { clearTimeout(t); res(JSON.parse(d.toString())); });
  ws.send(JSON.stringify({ type: 'ping' }));
});

describe('daemon', () => {
  let d;
  before(async () => { d = await startDaemon(); });
  after(() => d.stop());

  it('rejects a body over the limit with 413 and keeps serving', async () => {
    const res = await fetch(`http://127.0.0.1:${d.port}/exec`, {
      method: 'POST',
      headers: { 'X-Daemon-Token': TOKEN, 'Content-Type': 'application/json' },
      body: '{"action":"eval","code":"' + 'x'.repeat(70 * 1024 * 1024) + '"}',
    });
    assert.strictEqual(res.status, 413);
    const health = await fetch(`http://127.0.0.1:${d.port}/health`, { headers: { 'X-Daemon-Token': TOKEN } });
    assert.strictEqual(health.status, 200);
  });

  it('keeps the newer plugin connection when the older socket closes', async () => {
    // The close handler nulled `pluginWs` without checking whose socket it was: a reopened
    // plugin tab lost its connection the moment the old socket's close arrived.
    const first = await plugin(d.port);
    await sleep(50);
    const second = await plugin(d.port);
    await sleep(50);
    first.close();
    await sleep(200);
    const answer = await pingPong(second);
    assert.strictEqual(answer.type, 'pong');
    const health = await (await fetch(`http://127.0.0.1:${d.port}/health`, { headers: { 'X-Daemon-Token': TOKEN } })).json();
    assert.strictEqual(health.plugin, true, 'the daemon still counts a plugin as connected');
    second.close();
  });

  it('leaves no hot-reload copy of figma-client.js behind in src/', async () => {
    // One request makes the daemon copy figma-client.js next to itself; shutdown must
    // take that copy with it — it stayed forever and shipped in the npm tarball (220 KB).
    await fetch(`http://127.0.0.1:${d.port}/health`, { headers: { 'X-Daemon-Token': TOKEN } });
    d.child.kill('SIGTERM');
    await d.exited;
    // Only this daemon's copy (named with its pid): another daemon may be running.
    const copies = readdirSync(join(ROOT, 'src')).filter((f) => f.startsWith('.figma-client-') && f.includes(`.${d.child.pid}.`));
    assert.deepStrictEqual(copies, []);
  });
});

describe('daemon idle timer', () => {
  it('is not kept alive by unauthenticated requests', async () => {
    // The timer reset ran before the token check, so any local process — or a stray
    // browser tab hitting 403s — could keep the daemon up forever.
    const d = await startDaemon({ idleMs: 1200 });
    try {
      // Hammer it with token-less requests every 250 ms for up to 4 s. With the reset
      // behind the auth check the daemon idles out at ~1.2 s and a fetch starts failing;
      // with the reset in front of it the traffic keeps it alive for the whole 4 s.
      const t0 = Date.now();
      let refusedAt = null;
      while (Date.now() - t0 < 4000) {
        try { await fetch(`http://127.0.0.1:${d.port}/health`); } catch { refusedAt = Date.now() - t0; break; }
        await sleep(250);
      }
      assert.ok(refusedAt !== null && refusedAt < 3500, `daemon was kept alive by 403 traffic (refused at ${refusedAt} ms)`);
    } finally {
      d.stop();
    }
  });
});
