import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDaemonToken } from '../src/lib/daemon-token.js';

// The Safe Mode plugin keeps the token in clientStorage and re-prompts only when it has none,
// so a token that changes under it leaves the plugin knocking with the old one forever. A
// restart must therefore keep a valid token and mint one only when there is none to keep.

const HEX64 = 'a'.repeat(64);

function tempFile(t) {
  const dir = mkdtempSync(join(tmpdir(), 'daemon-token-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, '.figma-ds-cli', '.daemon-token');
}

test('mints a token when none exists, mode 600, and creates the directory', (t) => {
  const file = tempFile(t);
  const { token, reused } = ensureDaemonToken(file, { random: () => HEX64 });
  assert.equal(reused, false);
  assert.equal(token, HEX64);
  assert.equal(readFileSync(file, 'utf8'), HEX64);
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('reuses a valid token instead of rotating it', (t) => {
  const file = tempFile(t);
  ensureDaemonToken(file, { random: () => HEX64 });
  const second = ensureDaemonToken(file, { random: () => 'b'.repeat(64) });
  assert.equal(second.reused, true);
  assert.equal(second.token, HEX64, 'the file still holds the first token');
});

test('replaces a malformed or empty token file', (t) => {
  const file = tempFile(t);
  ensureDaemonToken(file, { random: () => HEX64 });
  writeFileSync(file, 'not a token\n');
  const { token, reused } = ensureDaemonToken(file, { random: () => 'c'.repeat(64) });
  assert.equal(reused, false);
  assert.equal(token, 'c'.repeat(64));
});
