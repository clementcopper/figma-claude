import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeoutMessage, explainEvalError } from '../src/lib/connection-help.js';

// `eval --timeout 2` on code that sleeps 5 s said "Execution timeout (2s). Try: daemon restart"
// with a healthy daemon and the code run exactly once — reported from the panel. The restart
// hint belongs to a daemon that did not answer; a code timeout names the budget and its flag.

test('a healthy daemon means the code was too slow: name the budget and its flag', () => {
  const msg = timeoutMessage(2000, true);
  assert.match(msg, /^Execution timeout \(2s\)/);
  assert.match(msg, /--timeout <seconds>/);
  assert.doesNotMatch(msg, /daemon restart/);
});

test('an unreachable daemon keeps the restart hint', () => {
  const msg = timeoutMessage(90000, false);
  assert.match(msg, /^Execution timeout \(90s\)/);
  assert.match(msg, /daemon restart/);
});

test('neither message is mistaken for a lost connection', () => {
  for (const healthy of [true, false]) {
    assert.equal(explainEvalError(timeoutMessage(2000, healthy)).connection, false);
  }
});

// 21 Sep 2026, from the panel: a 90 s findAll timed out, the 1 s /health call could not answer
// while Figma was still busy, and the message said "the daemon did not answer. Try: daemon
// restart" — a command the panel rule forbids and that would not have helped.

test('a daemon that did not answer the probe is called busy, not dead', () => {
  const msg = timeoutMessage(90000, false);
  assert.match(msg, /^Execution timeout \(90s\)/);
  assert.match(msg, /still busy/);
  assert.match(msg, /figma-cli status/);
  assert.match(msg, /--timeout <seconds>/);
});

test('inside the panel the message never names daemon restart', () => {
  const msg = timeoutMessage(90000, false, { panel: true });
  assert.doesNotMatch(msg, /daemon restart/);
  assert.match(msg, /still busy/);
  assert.doesNotMatch(timeoutMessage(2000, true, { panel: true }), /daemon restart/);
});
