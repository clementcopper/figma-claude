import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { PipeCodec, PipeTransport, designTargets, spawnFigmaWithPipe } from '../src/lib/figma-pipe.js';

// Figma's --remote-debugging-pipe speaks NUL-framed JSON on fds 3/4 to the *browser*
// endpoint; pages are reached through attached sessions. Everything below runs on a
// PassThrough pair with a scripted browser — no Figma, no fds.

test('PipeCodec reassembles frames split across chunks and drops torn ones', () => {
  const codec = new PipeCodec();
  assert.deepEqual(codec.decode('{"id":1,"res'), []);
  assert.deepEqual(codec.decode('ult":{}}\0{"id":2}\0{"id":3'), [{ id: 1, result: {} }, { id: 2 }]);
  assert.deepEqual(codec.decode('}\0not json\0\0'), [{ id: 3 }]);
  assert.equal(PipeCodec.encode({ id: 9, method: 'x' }), '{"id":9,"method":"x"}\0');
});

/** A browser that answers by method, and can push events. */
function fakeBrowser(answer) {
  const fromBrowser = new PassThrough();
  const toBrowser = new PassThrough();
  const codec = new PipeCodec();
  const received = [];
  toBrowser.on('data', (chunk) => {
    for (const msg of codec.decode(chunk)) {
      received.push(msg);
      const reply = answer(msg);
      if (reply) fromBrowser.write(PipeCodec.encode({ id: msg.id, ...(msg.sessionId ? { sessionId: msg.sessionId } : {}), ...reply }));
    }
  });
  const push = (event) => fromBrowser.write(PipeCodec.encode(event));
  return { transport: new PipeTransport(fromBrowser, toBrowser), received, push, fromBrowser, toBrowser };
}

test('send matches answers by id and routes session traffic to the attached view', async () => {
  const { transport, received, push } = fakeBrowser((msg) => {
    if (msg.method === 'Target.attachToTarget') return { result: { sessionId: 'S1' } };
    if (msg.method === 'Runtime.evaluate') return { result: { result: { value: msg.sessionId === 'S1' ? 'in session' : 'browser' } } };
    return { result: {} };
  });
  const attached = await transport.send('Target.attachToTarget', { targetId: 'T', flatten: true });
  assert.equal(attached.result.sessionId, 'S1');

  const view = transport.session('S1');
  const messages = [];
  view.on('message', (json) => messages.push(JSON.parse(json)));
  view.send(JSON.stringify({ id: 7, method: 'Runtime.evaluate', params: { expression: '1' } }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(received.at(-1).sessionId, 'S1', 'the view stamps its sessionId on every request');
  assert.equal(messages.at(-1).id, 7);
  assert.equal(messages.at(-1).result.result.value, 'in session');

  // An event for the session reaches the view; one for another session does not.
  push({ method: 'Runtime.executionContextCreated', sessionId: 'S1', params: { context: { id: 3 } } });
  push({ method: 'Runtime.executionContextCreated', sessionId: 'S2', params: { context: { id: 4 } } });
  await new Promise((r) => setTimeout(r, 10));
  const contexts = messages.filter((m) => m.method === 'Runtime.executionContextCreated').map((m) => m.params.context.id);
  assert.deepEqual(contexts, [3]);
  assert.equal(view.readyState, 1);
});

test('a closed pipe rejects what is pending and closes every session view', async () => {
  const { transport, fromBrowser } = fakeBrowser(() => null); // never answers
  const view = transport.session('S1');
  let closed = false;
  view.on('close', () => { closed = true; });
  const pending = transport.send('Browser.getVersion', {}, undefined, { timeoutMs: 5000 });
  fromBrowser.end();
  await assert.rejects(pending, /pipe closed/);
  assert.equal(closed, true);
  assert.equal(view.readyState, 3);
  await assert.rejects(transport.send('Browser.getVersion'), /closed/);
});

test('designTargets keeps design, file and board pages in the shape /json gives', () => {
  const targets = designTargets([
    { type: 'page', targetId: 'a', url: 'https://www.figma.com/file/x?node-id=1', title: 'Cards – Figma' },
    { type: 'page', targetId: 'b', url: 'https://www.figma.com/files/team/1', title: 'Files' },
    { type: 'page', targetId: 'c', url: 'https://www.figma.com/board/y', title: 'Jam' },
    { type: 'service_worker', targetId: 'd', url: 'https://www.figma.com/design/z' },
    { type: 'page', targetId: 'e', url: 'file:///Applications/Figma.app/Contents/Resources/app.asar/shell.html' },
  ]);
  assert.deepEqual(targets.map((t) => t.id), ['a', 'c']);
  assert.equal(targets[0].title, 'Cards – Figma');
});

test('spawnFigmaWithPipe passes --remote-debugging-pipe and takes fds 3 and 4', () => {
  let call;
  const fake = { stdio: [null, null, null, new PassThrough(), new PassThrough()], on() {} };
  const spawn = (bin, args, opts) => { call = { bin, args, opts }; return fake; };
  const { child, transport } = spawnFigmaWithPipe('/Applications/Figma.app/Contents/MacOS/Figma', { spawn });
  assert.equal(child, fake);
  assert.deepEqual(call.args, ['--remote-debugging-pipe']);
  assert.deepEqual(call.opts.stdio, ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']);
  assert.equal(transport.toBrowser, fake.stdio[3]);
  assert.equal(transport.fromBrowser, fake.stdio[4]);
});
