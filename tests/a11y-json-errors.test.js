import { describe, it } from 'node:test';
import assert from 'node:assert';
import { a11yErrorOutput } from '../src/commands/a11y.js';

// `a11y … --json` printed a red chalk line on failure, so a consumer parsing stdout got
// neither JSON nor a clue; `check --json` already answers `{ ok: false, error }`.

describe('a11yErrorOutput', () => {
  it('is JSON under --json and a red line otherwise', () => {
    assert.deepStrictEqual(JSON.parse(a11yErrorOutput('Node not found', { json: true })), { ok: false, error: 'Node not found' });
    assert.match(a11yErrorOutput('Node not found', {}), /✗ Node not found/);
  });
});
