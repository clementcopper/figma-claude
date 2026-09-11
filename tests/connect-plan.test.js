// Unit tests for the connect decision (pure, no Figma/CDP needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConnectAction } from '../src/lib/connect-plan.js';

test('a reachable CDP port means Figma is left alone', () => {
  assert.equal(resolveConnectAction({ cdpReachable: true, figmaRunning: true }), 'reuse');
});

test('CDP wins even if the process probe missed Figma', () => {
  // A reachable port proves a debuggable Figma exists, whatever pgrep says.
  assert.equal(resolveConnectAction({ cdpReachable: true, figmaRunning: false }), 'reuse');
});

test('Figma running without the debug port asks the user to quit', () => {
  assert.equal(resolveConnectAction({ cdpReachable: false, figmaRunning: true }), 'needs-quit');
});

test('no Figma at all means we start it ourselves', () => {
  assert.equal(resolveConnectAction({ cdpReachable: false, figmaRunning: false }), 'start-fresh');
});

// Pipe Mode: the daemon holds Figma's debugging pipe, and that Figma has no port.

test('a daemon that holds the pipe is reused, whatever the port says', () => {
  assert.equal(resolveConnectAction({ cdpReachable: false, figmaRunning: true, pipeHeld: true, pipe: true }), 'reuse-pipe');
  // Even a caller asking for the port path must not quit a pipe-held Figma.
  assert.equal(resolveConnectAction({ cdpReachable: false, figmaRunning: true, pipeHeld: true }), 'reuse-pipe');
});

test('a port that answers still wins for a pipe caller (a patched Figma is left alone)', () => {
  assert.equal(resolveConnectAction({ cdpReachable: true, figmaRunning: true, pipe: true }), 'reuse');
});

test('Figma running with neither port nor pipe asks the user to quit, in both modes', () => {
  assert.equal(resolveConnectAction({ cdpReachable: false, figmaRunning: true, pipe: true }), 'needs-quit');
});

test('no Figma at all starts it over the pipe when asked, over the port otherwise', () => {
  assert.equal(resolveConnectAction({ cdpReachable: false, figmaRunning: false, pipe: true }), 'start-pipe');
  assert.equal(resolveConnectAction({ cdpReachable: false, figmaRunning: false }), 'start-fresh');
});
