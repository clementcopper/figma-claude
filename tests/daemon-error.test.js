import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDaemonError } from '../src/lib/daemon-error.js';

const tokenFile = '/home/x/.figma-ds-cli/.daemon-token';

test('a 403 gets the token hint', () => {
  const r = classifyDaemonError({ status: 403, error: 'Unauthorized: missing token', tokenFile });
  assert.match(r.message, /^Unauthorized: missing token\nToken file: \/home\/x/);
  assert.match(r.message, /daemon restart/);
  assert.deepEqual(r.figmaStack, []);
});

test('a SyntaxError that happens to contain the word "token" is a code error, not an auth error', () => {
  // FEEDBACK.md 2026-10-02: `✗ SyntaxError: Invalid or unexpected token` came back with
  // `Token file: …` and `Try: daemon restart` — the hint was keyed on the word, not the status.
  const r = classifyDaemonError({ status: 500, error: 'SyntaxError: Invalid or unexpected token', tokenFile });
  assert.equal(r.message, 'SyntaxError: Invalid or unexpected token');
  assert.deepEqual(r.figmaStack, []);
});

test('a code error keeps its first line as the message and the frames as figmaStack', () => {
  const error = "TypeError: Cannot read properties of undefined (reading 'visible')\n    at get_visible (<anonymous>:4:17)\n    at <anonymous>:6:8";
  const r = classifyDaemonError({ status: 500, error, tokenFile });
  assert.equal(r.message, "TypeError: Cannot read properties of undefined (reading 'visible')");
  assert.deepEqual(r.figmaStack, ['    at get_visible (<anonymous>:4:17)', '    at <anonymous>:6:8']);
});

test('a closed Safe Mode plugin tab is explained', () => {
  const r = classifyDaemonError({ status: 500, error: 'Plugin not connected. Run the FigCli plugin', tokenFile });
  assert.match(r.message, /Plugins → Development → FigCli/);
});
