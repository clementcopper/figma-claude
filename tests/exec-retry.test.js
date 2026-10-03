import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryVerdict, failureLine } from '../src/lib/exec-retry.js';
import { FigmaClient } from '../src/figma-client.js';

const figmaError = Object.assign(new Error('in set_textAutoResize: Cannot write to node with unloaded font'), { fromFigma: true });
const transport = new Error('CDP connection closed');

test('a render is never retried, whatever the error', () => {
  assert.equal(retryVerdict({ action: 'render', attempt: 0, maxRetries: 2, error: transport }), 'mutating');
  assert.equal(retryVerdict({ action: 'render-batch', attempt: 0, maxRetries: 2, error: transport }), 'mutating');
});

test('an error Figma raised is never retried: the code ran up to the throw', () => {
  // 16 Sep 2026: a script threw on an unloaded font after detaching an instance and cloning a
  // header. Only the health probe stood between that and a second detach.
  assert.equal(retryVerdict({ action: 'eval', attempt: 0, maxRetries: 2, error: figmaError }), 'from-figma');
});

test('a transport fault on eval may be reconsidered until the tries are used up', () => {
  assert.equal(retryVerdict({ action: 'eval', attempt: 0, maxRetries: 2, error: transport }), 'consider');
  assert.equal(retryVerdict({ action: 'eval', attempt: 1, maxRetries: 2, error: transport }), 'consider');
  assert.equal(retryVerdict({ action: 'eval', attempt: 2, maxRetries: 2, error: transport }), 'exhausted');
});

test('FigmaClient.eval flags an exception from Figma, not a protocol or transport error', async () => {
  const client = new FigmaClient();
  client.ws = { readyState: 1 };
  client.send = async () => ({ result: { exceptionDetails: { exception: { value: 'Error: in set_textAutoResize: unloaded font' } } } });
  await assert.rejects(client.eval('1'), (e) => e.fromFigma === true && /unloaded font/.test(e.message));

  client.send = async () => ({ error: { message: 'Cannot find context with specified id', code: -32000 } });
  await assert.rejects(client.eval('1'), (e) => !e.fromFigma && /Cannot find context/.test(e.message));

  client.ws = null;
  await assert.rejects(client.eval('1'), (e) => !e.fromFigma && /Not connected/.test(e.message));
});

test('the log line names a first failure without counting attempts', () => {
  assert.equal(failureLine(0, new Error('x')), '[daemon] Failed: x');
  assert.equal(failureLine(1, new Error('x')), '[daemon] Retry 1 failed: x');
  assert.equal(failureLine(0, 'plain'), '[daemon] Failed: plain');
});

test('a compile error from Figma carries its location in the same shape as a runtime stack', async () => {
  // Runtime errors arrive with V8 frames inside exception.description; a SyntaxError has none,
  // only exceptionDetails.lineNumber/columnNumber (0-based). Both must read the same downstream.
  const client = new FigmaClient();
  client.ws = { readyState: 1 };
  client.send = async () => ({ result: { exceptionDetails: { lineNumber: 2, columnNumber: 13, exception: { description: 'SyntaxError: Invalid or unexpected token' } } } });
  await assert.rejects(client.eval('1'), (e) => e.fromFigma === true && e.message === 'SyntaxError: Invalid or unexpected token\n    at <anonymous>:3:14');

  client.send = async () => ({ result: { exceptionDetails: { lineNumber: 0, columnNumber: 0, exception: { description: 'TypeError: x\n    at f (<anonymous>:4:17)' } } } });
  await assert.rejects(client.eval('1'), (e) => e.message === 'TypeError: x\n    at f (<anonymous>:4:17)');
});

test('a value CDP cannot return by value counts as raised inside Figma: the code ran', async () => {
  const client = new FigmaClient();
  client.ws = { readyState: 1 };
  client.send = async () => ({ error: { message: "Object couldn't be returned by value", code: -32000 } });
  await assert.rejects(client.eval('1'), (e) => e.fromFigma === true && /returned by value/.test(e.message));
});

test('a timed-out eval is never retried or torn down: Figma may still be running the code', () => {
  // FEEDBACK.md 21 Sep 2026: a file-wide findAll ran past 90 s; the daemon probed a renderer
  // still busy with it, read "dead", detached the pipe client and ran the findAll twice more.
  const timeout = new Error('Execution timeout (90s)');
  assert.equal(retryVerdict({ action: 'eval', attempt: 0, maxRetries: 2, error: timeout }), 'timed-out');
  assert.equal(retryVerdict({ action: 'eval', attempt: 1, maxRetries: 2, error: timeout }), 'timed-out');
});
