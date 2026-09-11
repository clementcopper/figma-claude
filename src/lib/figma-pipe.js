/**
 * Chrome DevTools Protocol over Figma's --remote-debugging-pipe.
 *
 * Figma Desktop strips `--remote-debugging-port` from its own argv, which is why Yolo Mode
 * patches app.asar and re-signs the app. It does not strip `--remote-debugging-pipe`: spawn
 * the binary with file descriptors 3 (browser reads) and 4 (browser writes) and CDP answers
 * on them — no patch, no port, no App Management permission, the signature untouched.
 *
 * Messages are JSON, each terminated by a NUL byte. The pipe is one connection to the
 * *browser* endpoint; a page is reached by `Target.attachToTarget({flatten: true})`, after
 * which every request carries that `sessionId`. `PipeTransport.session()` hides that behind
 * the WebSocket-shaped object `FigmaClient` already knows.
 *
 * Whoever holds the pipe holds Figma: closing it may quit Figma (seen once in two runs), so
 * the daemon keeps it open for as long as it lives and hands it to its successor on restart.
 */
import { EventEmitter } from 'node:events';
import { spawn as nodeSpawn } from 'node:child_process';
import net from 'node:net';

/**
 * NUL-framed JSON: bytes in, complete messages out. Pure, so the framing is unit-tested.
 *
 * Chunks stay Buffers until a frame is complete: the pipe cuts every 64 KB with no regard
 * for UTF-8, and decoding chunk by chunk turned an `ä` on the cut into two U+FFFD. Only the
 * new chunk is searched for the NUL — appending to one string and scanning it from the
 * start again was quadratic, 4.5 s of codec time for a 25 MB export result.
 */
export class PipeCodec {
  constructor() { this.pending = []; }

  /** @param {Buffer|string} chunk @returns {object[]} every message completed by this chunk */
  decode(chunk) {
    let buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    const out = [];
    let end;
    while ((end = buf.indexOf(0)) >= 0) {
      this.pending.push(buf.subarray(0, end));
      const raw = Buffer.concat(this.pending).toString('utf8');
      this.pending = [];
      buf = buf.subarray(end + 1);
      if (!raw) continue;
      try { out.push(JSON.parse(raw)); } catch { /* a torn frame is dropped, never re-thrown into the reader */ }
    }
    if (buf.length) this.pending.push(buf);
    return out;
  }

  static encode(message) { return JSON.stringify(message) + '\0'; }
}

/**
 * One CDP connection over a pipe pair. `send()` matches answers by id; events (no id) go out
 * as 'event'. Sessions demultiplex by `sessionId`.
 */
export class PipeTransport extends EventEmitter {
  /**
   * @param {import('stream').Readable} fromBrowser  what the browser writes (its fd 4)
   * @param {import('stream').Writable} toBrowser    what the browser reads (its fd 3)
   */
  constructor(fromBrowser, toBrowser) {
    super();
    this.fromBrowser = fromBrowser;
    this.toBrowser = toBrowser;
    this.codec = new PipeCodec();
    this.nextId = 0;
    this.pending = new Map();
    this.sessions = new Map();
    this.closed = false;

    fromBrowser.on('data', (chunk) => {
      for (const msg of this.codec.decode(chunk)) this.dispatch(msg);
    });
    const onGone = () => this.handleClose();
    fromBrowser.on('end', onGone);
    fromBrowser.on('close', onGone);
    fromBrowser.on('error', (e) => { this.emit('error', e); this.handleClose(); });
    toBrowser.on('error', (e) => { this.emit('error', e); this.handleClose(); });
  }

  dispatch(msg) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, timer } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(timer);
      resolve(msg);
      return;
    }
    if (msg.sessionId && this.sessions.has(msg.sessionId)) {
      this.sessions.get(msg.sessionId).deliver(msg);
    }
    if (msg.method) this.emit('event', msg);
  }

  /** Raw write of one message; the caller owns the id. */
  write(message) {
    if (this.closed) throw new Error('Figma pipe is closed');
    this.toBrowser.write(PipeCodec.encode(message));
  }

  /**
   * One request to the browser endpoint (or to a session). Resolves with the whole message
   * (`{ id, result }` or `{ id, error }`), like FigmaClient.send does over WebSocket.
   */
  send(method, params = {}, sessionId = undefined, { timeoutMs = 90000 } = {}) {
    return new Promise((resolve, reject) => {
      if (this.closed) { reject(new Error('Figma pipe is closed')); return; }
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP request ${method} timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      try { this.write(msg); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }

  /**
   * A WebSocket-shaped view of one attached target: `send(json)` stamps the sessionId,
   * 'message' fires with the JSON string of every message carrying it. FigmaClient uses this
   * exactly like the `ws` socket it opens in port mode — readyState, send, on, close.
   */
  session(sessionId) {
    const transport = this;
    const emitter = new EventEmitter();
    const view = {
      readyState: 1,
      on: (event, fn) => emitter.on(event, fn),
      once: (event, fn) => emitter.once(event, fn),
      off: (event, fn) => emitter.off(event, fn),
      send(json) {
        const msg = JSON.parse(json);
        msg.sessionId = sessionId;
        transport.write(msg);
      },
      close() {
        if (view.readyState === 3) return;
        view.readyState = 3;
        transport.sessions.delete(sessionId);
        // Detach in the browser too; best effort, the pipe may already be gone.
        try { transport.send('Target.detachFromTarget', { sessionId }, undefined, { timeoutMs: 2000 }).catch(() => {}); } catch {}
        emitter.emit('close');
      },
      deliver(msg) { emitter.emit('message', JSON.stringify(msg)); },
      markClosed() {
        if (view.readyState === 3) return;
        view.readyState = 3;
        emitter.emit('close');
      },
    };
    this.sessions.set(sessionId, view);
    return view;
  }

  handleClose() {
    if (this.closed) return;
    this.closed = true;
    for (const [id, { reject, timer }] of this.pending) {
      clearTimeout(timer);
      this.pending.delete(id);
      reject(new Error('Figma pipe closed'));
    }
    for (const view of this.sessions.values()) view.markClosed();
    this.sessions.clear();
    this.emit('close');
  }

  /** Release the pipe. Figma may quit when its debugging pipe goes away. */
  close() {
    this.handleClose();
    try { this.toBrowser.end(); } catch {}
    try { this.fromBrowser.destroy(); } catch {}
  }
}

/**
 * Launch Figma with the debugging pipe. The child's fd 3 is our `toBrowser` writable, its
 * fd 4 our `fromBrowser` readable. Both are Node sockets, so they can be passed on as `stdio`
 * entries to a successor process (Node duplicates the underlying descriptors).
 *
 * @param {string} binary   path of the Figma executable (the Mach-O inside the bundle on macOS)
 * @param {{ spawn?: typeof nodeSpawn, args?: string[] }} [opts]  `spawn` is a test seam
 */
export function spawnFigmaWithPipe(binary, opts = {}) {
  const spawn = opts.spawn || nodeSpawn;
  const child = spawn(binary, ['--remote-debugging-pipe', ...(opts.args || [])], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
  });
  const toBrowser = child.stdio[3];
  const fromBrowser = child.stdio[4];
  const transport = new PipeTransport(fromBrowser, toBrowser);
  child.on('exit', () => transport.handleClose());
  // A binary that cannot be started (missing, not executable) surfaces as an 'error' on the
  // child; unhandled, it would take the daemon down with a stack trace instead of a message.
  child.on('error', (e) => { transport.emit('error', e); transport.handleClose(); });
  return { child, transport, toBrowser, fromBrowser };
}

/**
 * The pipe a predecessor handed to this process as its own fds 3 and 4 (see the daemon's
 * /handoff). Wrapped as sockets so they can be handed on again.
 */
export function inheritedPipe() {
  const toBrowser = new net.Socket({ fd: 3, readable: false, writable: true });
  const fromBrowser = new net.Socket({ fd: 4, readable: true, writable: false });
  const transport = new PipeTransport(fromBrowser, toBrowser);
  return { transport, toBrowser, fromBrowser };
}

/** The design/board page targets among a `Target.getTargets` answer, in the shape `/json` gives. */
export function designTargets(targetInfos) {
  return (targetInfos || [])
    .filter((t) => t.type === 'page' && typeof t.url === 'string' && /figma\.com\/(design|file|board)\//.test(t.url))
    .map((t) => ({ title: t.title, id: t.targetId, url: t.url }));
}
