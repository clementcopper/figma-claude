import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
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

async function startDaemon({ idleMs = 60000, mode = 'plugin', env: extraEnv = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'figma-cli-daemon-test-'));
  mkdirSync(join(home, '.figma-ds-cli'), { recursive: true });
  writeFileSync(join(home, '.figma-ds-cli', '.daemon-token'), TOKEN);
  const port = await freePort();
  const child = spawn(process.execPath, [join(ROOT, 'src', 'daemon.js')], {
    env: { ...process.env, HOME: home, DAEMON_PORT: String(port), DAEMON_MODE: mode, DAEMON_IDLE_TIMEOUT: String(idleMs), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  // Listen for the exit before waiting on health: a daemon that quits at once (pipe mode
  // without a Figma to hold) exited during the wait and the promise never settled.
  const exited = new Promise((r) => child.on('exit', r));
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) break;
    try { await fetch(`http://127.0.0.1:${port}/health`, { headers: { 'X-Daemon-Token': TOKEN } }); break; } catch { await sleep(100); }
  }
  const stop = () => { try { child.kill('SIGTERM'); } catch {} rmSync(home, { recursive: true, force: true }); };
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

  it('names the plugin\'s file in /health and forgets it when the plugin goes', async () => {
    // /health knew a file only from the CDP page title, so in Safe Mode it said null and the
    // CLI's FIGMA_FILE pin had nothing to compare. The plugin now says which file it runs in.
    const health = async () => (await fetch(`http://127.0.0.1:${d.port}/health`, { headers: { 'X-Daemon-Token': TOKEN } })).json();
    const ws = await plugin(d.port);
    ws.send(JSON.stringify({ type: 'hello', mode: 'plugin', file: 'Design System' }));
    await sleep(100);
    assert.strictEqual((await health()).file, 'Design System');
    ws.close();
    await sleep(200);
    assert.strictEqual((await health()).file, null, 'no plugin, no file');
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

describe('the sync CLI path carries a large answer', () => {
  it('figmaEvalSync returns a 3 MB result instead of falling through to "fetch failed"', async () => {
    // `curlDaemon` ran curl through execSync with Node's default 1 MB maxBuffer. An export
    // above that (any full-page PNG) died with ENOBUFS, and figmaEvalSync took that for a
    // dead daemon and tried a direct CDP connection — "✗ fetch failed" in Pipe Mode, where no
    // port exists. Live: `export node 2:2 -s 1` on an 8.6 MB frame, 2026-09-11.
    const d = await startDaemon();
    const ws = await plugin(d.port);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.action === 'eval') ws.send(JSON.stringify({ type: 'result', id: msg.id, result: 'x'.repeat(3 * 1024 * 1024) }));
    });
    try {
      const probe = `import { figmaEvalSync } from ${JSON.stringify(join(ROOT, 'src', 'lib', 'cli-core.js'))};
        try { console.log('LENGTH ' + figmaEvalSync('1').length); } catch (e) { console.log('ERROR ' + e.message); }`;
      // Spawned, not execFileSync: the fake plugin above lives in this process, and a blocked
      // event loop cannot answer the daemon's eval while it waits for the probe.
      const out = await new Promise((resolve, reject) => {
        const p = spawn(process.execPath, ['--input-type=module', '-e', probe], {
          env: { ...process.env, HOME: d.home, DAEMON_PORT: String(d.port) },
          stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
        });
        let stdout = '';
        p.stdout.on('data', (c) => { stdout += c; });
        p.on('error', reject);
        p.on('exit', () => resolve(stdout.trim()));
      });
      assert.strictEqual(out, `LENGTH ${3 * 1024 * 1024}`);
    } finally {
      ws.close();
      d.stop();
    }
  });
});

describe('daemon start sweeps hot-reload copies of dead daemons', () => {
  it('removes a copy whose pid is gone and keeps one whose pid lives', async () => {
    // shutdown() removes a daemon's own copy; a killed or crashed daemon left its copy in
    // src/ for good (nine of them after a day). The next start removes those of dead pids.
    const deadPid = 2 ** 22 - 1;                       // above any pid macOS or Linux hands out
    const dead = join(ROOT, 'src', `.figma-client-1.${deadPid}.mjs`);
    const live = join(ROOT, 'src', `.figma-client-1.${process.pid}.mjs`);
    writeFileSync(dead, '// stale copy');
    writeFileSync(live, '// copy of a running process');
    const d = await startDaemon();
    try {
      await sleep(200);
      assert.strictEqual(existsSync(dead), false, 'copy of a dead pid is swept');
      assert.strictEqual(existsSync(live), true, 'copy of a live pid is left alone');
    } finally {
      d.stop();
      rmSync(live, { force: true });
      rmSync(dead, { force: true });
    }
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
      while (Date.now() - t0 < 6000) {
        try { await fetch(`http://127.0.0.1:${d.port}/health`); } catch { refusedAt = Date.now() - t0; break; }
        await sleep(250);
      }
      // 1.2 s idle + the shutdown's own 3 s force-exit ceiling is the worst honest case.
      assert.ok(refusedAt !== null && refusedAt < 4000, `daemon was kept alive by 403 traffic (refused at ${refusedAt} ms)`);
    } finally {
      d.stop();
    }
  });
});

// Pipe Mode: the daemon launches "Figma" (tests/helpers/fake-figma.mjs, which speaks CDP on
// fds 3/4) and holds its debugging pipe. No port, no patch, nothing of the user's touched.
describe('daemon in pipe mode', () => {
  const FAKE = join(ROOT, 'tests', 'helpers', 'fake-figma.mjs');
  const health = (port) => fetch(`http://127.0.0.1:${port}/health`, { headers: { 'X-Daemon-Token': TOKEN } }).then((r) => r.json());
  const exec = (port, code) => fetch(`http://127.0.0.1:${port}/exec`, {
    method: 'POST', headers: { 'X-Daemon-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'eval', code }),
  }).then((r) => r.json());
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  // Polls until `probe` is true; a probe that throws (port not up yet) counts as false.
  const until = async (probe, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await probe()) return true; } catch {} await sleep(100); } return false; };

  it('launches Figma over the pipe, reports pipe mode, evaluates in the figma context and lists files', async () => {
    const d = await startDaemon({ mode: 'pipe', env: { FIGMA_PIPE_LAUNCH: '1', FIGMA_BINARY: FAKE, FAKE_FIGMA_FILE: 'Pipe Dream' } });
    try {
      assert.ok(await until(async () => (await health(d.port)).cdp === true), `never connected: ${d.log()}`);
      const h = await health(d.port);
      assert.equal(h.mode, 'pipe');
      assert.equal(h.pipe, true);
      assert.equal(h.file, 'Pipe Dream – Figma');
      assert.equal((await exec(d.port, '1 + 1')).result, 2);
      assert.equal((await exec(d.port, 'figma.root.name')).result, 'Pipe Dream', 'evaluated in the context that holds figma');
      const files = await (await fetch(`http://127.0.0.1:${d.port}/files`, { headers: { 'X-Daemon-Token': TOKEN } })).json();
      assert.deepStrictEqual(files.map((f) => f.title), ['Pipe Dream – Figma']);
    } finally { d.stop(); }
  });

  it('hands the pipe to a successor daemon on /handoff and Figma never notices', async () => {
    const d = await startDaemon({ mode: 'pipe', env: { FIGMA_PIPE_LAUNCH: '1', FIGMA_BINARY: FAKE } });
    let successorPid = null;
    try {
      assert.ok(await until(async () => (await health(d.port)).cdp === true), d.log());
      const answer = await (await fetch(`http://127.0.0.1:${d.port}/handoff`, { method: 'POST', headers: { 'X-Daemon-Token': TOKEN } })).json();
      assert.equal(answer.status, 'handing-off');
      successorPid = answer.pid;
      await d.exited;
      assert.ok(await until(async () => { try { return (await health(d.port)).cdp === true; } catch { return false; } }, 10000), 'successor never answered on the same port');
      assert.equal((await exec(d.port, 'figma.currentPage.name')).result, 'Page 1', 'the successor evaluates through the inherited pipe');
      assert.ok(alive(successorPid));
    } finally {
      if (successorPid) { try { process.kill(successorPid, 'SIGTERM'); } catch {} }
      d.stop();
    }
  });

  it('exits when Figma goes away, and refuses to launch Figma unasked', async () => {
    const d = await startDaemon({ mode: 'pipe', env: { FIGMA_PIPE_LAUNCH: '1', FIGMA_BINARY: FAKE } });
    try {
      assert.ok(await until(async () => (await health(d.port)).cdp === true), d.log());
      const figmaPid = Number((d.log().match(/Launched Figma .*pid (\d+)/) || [])[1]);
      assert.ok(figmaPid > 0, 'daemon named the Figma pid');
      process.kill(figmaPid, 'SIGTERM');
      await Promise.race([d.exited, sleep(5000).then(() => { throw new Error('daemon outlived the pipe'); })]);
    } finally { d.stop(); }

    // A CLI respawn after Figma quit must not open Figma from a random command.
    const orphan = await startDaemon({ mode: 'pipe' });
    try {
      const code = await Promise.race([orphan.exited, sleep(5000).then(() => 'timeout')]);
      assert.equal(code, 2, `expected exit 2, got ${code}: ${orphan.log()}`);
      assert.match(orphan.log(), /run figma-cli connect/);
    } finally { orphan.stop(); }
  });
});
