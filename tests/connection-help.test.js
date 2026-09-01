import { describe, it } from 'node:test';
import assert from 'node:assert';
import { connectAdvice, explainEvalError, inPanel } from '../src/lib/connection-help.js';

describe('connectAdvice', () => {
  it('names the CLI in a terminal — and not the legacy binary', () => {
    const lines = connectAdvice({ panel: false }).join('\n');
    assert.match(lines, /figma-cli connect/);
    assert.match(lines, /--safe/);
    assert.match(lines, /daemon restart/, 'a daemon that lost CDP is the usual culprit');
    assert.doesNotMatch(lines, /figma-ds-cli/, 'the legacy alias is not what anyone types');
  });

  it('names the panel button inside FigmaClaude.app, never a connect command', () => {
    const lines = connectAdvice({ panel: true }).join('\n');
    assert.match(lines, /Figma menu/);
    assert.match(lines, /Connect/);
    assert.doesNotMatch(lines, /figma-cli connect(?! yourself)/,
      'a panel session is told not to connect itself');
  });

  it('defaults to the terminal wording', () => {
    assert.deepStrictEqual(connectAdvice(), connectAdvice({ panel: false }));
  });
});

describe('explainEvalError', () => {
  // The message the panel actually reported: a shell and an errno, no state and no way back.
  it('turns spawnSync ETIMEDOUT into a state plus a way back', () => {
    const { connection, lines } = explainEvalError('spawnSync /bin/sh ETIMEDOUT', { panel: false });
    assert.strictEqual(connection, true);
    assert.match(lines[0], /did not answer/);
    assert.doesNotMatch(lines[0], /spawnSync/, 'the shell is not the reader\'s problem');
    assert.match(lines.join('\n'), /figma-cli connect/);
  });

  it('routes the same timeout to the panel button when in the panel', () => {
    const { lines } = explainEvalError('spawnSync /bin/sh ETIMEDOUT', { panel: true });
    assert.match(lines.join('\n'), /Figma menu/);
  });

  it('recognises a refused connection', () => {
    for (const m of ['connect ECONNREFUSED 127.0.0.1:3456', 'fetch failed', 'socket hang up']) {
      const { connection, lines } = explainEvalError(m, { panel: false });
      assert.strictEqual(connection, true, m);
      assert.match(lines[0], /never reached Figma/, m);
      assert.doesNotMatch(lines[0], /Figma is not (running|connected)/i,
        'fetch failed cannot tell a stopped daemon from one whose CDP link died');
    }
  });

  // Dressing a code error up as a lost connection sends the reader to the wrong place entirely.
  it('passes an ordinary code error through untouched', () => {
    const msg = 'TypeError: x is not a function';
    const { connection, lines } = explainEvalError(msg, { panel: true });
    assert.strictEqual(connection, false);
    assert.deepStrictEqual(lines, [msg]);
  });

  it('survives a missing message', () => {
    assert.deepStrictEqual(explainEvalError(undefined), { connection: false, lines: [''] });
  });
});

describe('inPanel', () => {
  it('reads the marker the panel exports', () => {
    assert.strictEqual(inPanel({ FIGMACLAUDE: '1' }), true);
    assert.strictEqual(inPanel({}), false);
    assert.strictEqual(inPanel({ FIGMACLAUDE: '' }), false);
  });
});
