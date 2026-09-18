import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionVerdict } from '../src/lib/connection-gate.js';

const connected = { status: 'ok', cdp: true, mode: 'pipe' };
const pluginConnected = { status: 'ok', plugin: true, mode: 'safe' };
const notConnected = (mode) => ({ status: 'disconnected', cdp: false, plugin: null, mode });

test('a daemon that drives Figma ends it, whatever the mode', () => {
  assert.equal(connectionVerdict({ health: connected }), 'ok');
  assert.equal(connectionVerdict({ health: pluginConnected }), 'ok');
  assert.equal(connectionVerdict({ health: { status: 'ok', cdp: true, mode: 'yolo' } }), 'ok');
});

test('a portless mode asks the daemon a second time before giving up', () => {
  // The port probe cannot succeed in Pipe or Safe Mode, so it must not be the decider: measured
  // 2026-09-18, /health cdp:true while FigmaClient.isConnected() said false.
  for (const mode of ['pipe', 'safe']) {
    assert.equal(connectionVerdict({ health: notConnected(mode), attempt: 0 }), 'retry');
    assert.equal(connectionVerdict({ health: notConnected(mode), attempt: 1 }), 'fail');
  }
});

test('a mode with a debug port keeps the port probe as its fallback', () => {
  assert.equal(connectionVerdict({ health: notConnected('yolo'), attempt: 0 }), 'probe-port');
  assert.equal(connectionVerdict({ health: notConnected('browser'), attempt: 1 }), 'probe-port');
});

test('the daemon\'s own mode beats the config, and the config fills in when it is silent', () => {
  // `connect --safe` writes config.mode before the daemon restarts, so the config can name a
  // mode the running daemon is not in.
  assert.equal(connectionVerdict({ health: notConnected('yolo'), configMode: 'pipe' }), 'probe-port');
  assert.equal(connectionVerdict({ health: null, configMode: 'pipe', attempt: 0 }), 'retry');
  assert.equal(connectionVerdict({ health: null, configMode: 'pipe', attempt: 1 }), 'fail');
});

test('no daemon and no known mode falls back to the port probe, as before', () => {
  assert.equal(connectionVerdict({ health: null }), 'probe-port');
  assert.equal(connectionVerdict({}), 'probe-port');
  assert.equal(connectionVerdict(), 'probe-port');
});
