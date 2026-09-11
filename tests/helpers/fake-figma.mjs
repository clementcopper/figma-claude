#!/usr/bin/env node
// A stand-in for Figma Desktop launched with --remote-debugging-pipe: speaks just enough CDP
// on fds 3 (in) and 4 (out) for the daemon's pipe mode — one design page target, attachable,
// Runtime.enable announcing one execution context that holds a `figma` stub, and
// Runtime.evaluate through `vm`. Used by tests/daemon-live.test.js; never by users.
import { createRequire } from 'node:module';
import vm from 'node:vm';
import net from 'node:net';
import { PipeCodec } from '../../src/lib/figma-pipe.js';

const input = new net.Socket({ fd: 3, readable: true, writable: false });
const output = new net.Socket({ fd: 4, readable: false, writable: true });
const codec = new PipeCodec();
const send = (msg) => output.write(PipeCodec.encode(msg));

const FILE = process.env.FAKE_FIGMA_FILE || 'Fake File';
const TARGET = { targetId: 'T-design', type: 'page', title: `${FILE} – Figma`, url: 'https://www.figma.com/file/fakefile?node-id=0-1', attached: false };
const OTHER = { targetId: 'T-files', type: 'page', title: 'Figma', url: 'https://www.figma.com/files/team/1', attached: false };
let sessions = 0;
const context = vm.createContext({
  figma: { root: { name: FILE }, currentPage: { name: 'Page 1', children: [{}, {}, {}], findAll: () => [1, 2, 3] } },
});

input.on('data', (chunk) => {
  for (const msg of codec.decode(chunk)) {
    const { id, method, params = {}, sessionId } = msg;
    const reply = (result) => send(sessionId ? { id, sessionId, result } : { id, result });
    switch (method) {
      case 'Browser.getVersion': reply({ product: 'Chrome/148.0 fake', userAgent: 'FakeFigma' }); break;
      case 'Target.getTargets': reply({ targetInfos: [OTHER, TARGET] }); break;
      case 'Target.attachToTarget': {
        const sid = `S${++sessions}`;
        reply({ sessionId: sid });
        break;
      }
      case 'Target.detachFromTarget': reply({}); break;
      case 'Runtime.enable':
        reply({});
        // Figma's real order: the page's own context first, the one with `figma` later.
        send({ method: 'Runtime.executionContextCreated', sessionId, params: { context: { id: 1, name: '', origin: 'https://www.figma.com' } } });
        send({ method: 'Runtime.executionContextCreated', sessionId, params: { context: { id: 2, name: 'figma', origin: 'https://www.figma.com' } } });
        break;
      case 'Runtime.evaluate': {
        const wantsFigma = params.contextId === 2;
        try {
          const value = wantsFigma
            ? vm.runInContext(params.expression, context)
            : vm.runInNewContext(params.expression, {});
          Promise.resolve(value).then(
            (v) => reply({ result: { type: typeof v, value: v } }),
            (e) => reply({ result: { type: 'object' }, exceptionDetails: { text: String(e && e.message || e) } }),
          );
        } catch (e) {
          reply({ result: { type: 'object' }, exceptionDetails: { text: String(e && e.message || e), exception: { value: String(e && e.message || e) } } });
        }
        break;
      }
      default: send(sessionId ? { id, sessionId, error: { code: -32601, message: `unknown ${method}` } } : { id, error: { code: -32601, message: `unknown ${method}` } });
    }
  }
});
// Whoever holds the pipe holds Figma: when it closes, this Figma quits too.
input.on('end', () => process.exit(0));
input.on('close', () => process.exit(0));
input.on('error', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
