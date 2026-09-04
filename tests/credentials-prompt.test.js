import { describe, it } from 'node:test';
import assert from 'node:assert';
import { consumeKeyChunk, windowsCmdkeyArgs } from '../src/credentials.js';

// The hidden prompt compared whole chunks with '\r': a pasted key arrives with its Enter in
// one chunk ("sk-ant-…\r"), matched neither branch, and the prompt never resolved. And on
// win32 the key went unquoted into a cmdkey command line.

describe('consumeKeyChunk', () => {
  it('finishes on the Enter inside a pasted chunk', () => {
    assert.deepStrictEqual(consumeKeyChunk('', 'sk-ant-abc\r'), { input: 'sk-ant-abc', done: true, echoed: 10 });
  });

  it('types character by character, backspace included', () => {
    let s = consumeKeyChunk('', 'a'); s = consumeKeyChunk(s.input, 'b'); s = consumeKeyChunk(s.input, '\u007f');
    assert.deepStrictEqual(s, { input: 'a', done: false, echoed: -1 });
    assert.deepStrictEqual(consumeKeyChunk('a', '\n'), { input: 'a', done: true, echoed: 0 });
  });

  it('reports Ctrl+C', () => {
    assert.strictEqual(consumeKeyChunk('x', '\u0003').interrupted, true);
  });
});

describe('windowsCmdkeyArgs', () => {
  it('passes the secret as one argument, whatever it contains', () => {
    const args = windowsCmdkeyArgs('svc', 'openai', 'p&ss word "q"');
    assert.ok(args.includes('/pass:p&ss word "q"'));
    assert.ok(args.every((a) => typeof a === 'string'));
  });
});
