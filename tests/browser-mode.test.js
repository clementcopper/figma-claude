// Unit tests for Browser Mode launch helpers (pure, no browser/Figma needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserDebugArgs, getBrowserCommand } from '../src/platform.js';

// ---------- browserDebugArgs ----------

test('browserDebugArgs enables remote debugging on the given port', () => {
  const args = browserDebugArgs(9222, '/tmp/prof');
  assert.ok(args.includes('--remote-debugging-port=9222'));
});

test('browserDebugArgs allows CDP WebSocket origins (Chrome 111+ requirement)', () => {
  const args = browserDebugArgs(9222, '/tmp/prof');
  assert.ok(args.includes('--remote-allow-origins=*'));
});

test('browserDebugArgs isolates the debug session in its own profile dir', () => {
  const args = browserDebugArgs(9222, '/home/u/.figma-ds-cli/chrome-profile');
  assert.ok(args.includes('--user-data-dir=/home/u/.figma-ds-cli/chrome-profile'));
});

test('browserDebugArgs opens Figma as the last (URL) argument', () => {
  const args = browserDebugArgs(9222, '/tmp/prof');
  assert.equal(args[args.length - 1], 'https://www.figma.com');
});

test('browserDebugArgs honors a custom port and url', () => {
  const args = browserDebugArgs(9333, '/tmp/prof', 'https://www.figma.com/design/abc');
  assert.ok(args.includes('--remote-debugging-port=9333'));
  assert.equal(args[args.length - 1], 'https://www.figma.com/design/abc');
});

// ---------- getBrowserCommand ----------

test('getBrowserCommand quotes a profile dir that contains spaces', () => {
  const cmd = getBrowserCommand(9222, '/Users/Jane Doe/.figma-ds-cli/chrome-profile');
  assert.ok(cmd.includes('"--user-data-dir=/Users/Jane Doe/.figma-ds-cli/chrome-profile"'));
});

test('getBrowserCommand carries the debug flags for a copy-paste launch', () => {
  const cmd = getBrowserCommand(9222, '/tmp/prof');
  assert.ok(cmd.includes('--remote-debugging-port=9222'));
  assert.ok(cmd.includes('--remote-allow-origins=*'));
  assert.ok(cmd.trim().endsWith('https://www.figma.com'));
});
