import { describe, it } from 'node:test';
import assert from 'node:assert';
import { errorOutput } from '../src/lib/cli-output.js';

// `get 9999:9999 --json` printed the plain string "No node found" and exited 0 — a script
// parsing stdout got neither JSON nor a non-zero code. One helper answers the shape every
// read command promises in `docs scripting-the-cli`: `{ ok: false, error }` under --json, a
// red ✗ line otherwise. `a11yErrorOutput` is the same rule, kept where its test lives.

describe('errorOutput', () => {
  it('is one-line JSON under --json', () => {
    assert.deepStrictEqual(JSON.parse(errorOutput('Node not found: 9999:9999', { json: true })), { ok: false, error: 'Node not found: 9999:9999' });
  });
  it('is a red ✗ line without --json, and tolerates no options at all', () => {
    assert.match(errorOutput('Node not found: 9999:9999', {}), /✗ Node not found: 9999:9999/);
    assert.match(errorOutput('Node not found: 9999:9999'), /✗ Node not found/);
  });
});
