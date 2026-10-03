import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntaxError } from '../src/lib/syntax-check.js';

test('a file cut in half by a text replace is located by line and column before anything is sent', () => {
  // FEEDBACK.md 2026-10-02: `section: 4const TIERS = {` — reported with a daemon-token hint
  // and no line; `node --check` found it at once.
  const code = 'const a = 1;\nconst b = {\n  section: 4const TIERS = {\n};\nreturn b;\n';
  const se = syntaxError(code, '_run.js');
  assert.equal(se.line, 3);
  assert.equal(se.message, 'Invalid or unexpected token');
  assert.equal(se.excerpt[0], '  section: 4const TIERS = {');
  assert.match(se.excerpt[1], /^\s+\^/);
  assert.ok(se.column >= 12 && se.column <= 14, 'column ' + se.column);
});

test('a real error after a top-level return is the one reported, not "Illegal return"', () => {
  const code = 'const a = await figma.getNodeByIdAsync("1");\nif (!a) return null;\nconst b = ;\nreturn b;';
  const se = syntaxError(code, 'x.js');
  assert.equal(se.line, 3);
  assert.match(se.message, /Unexpected token/);
});

test('code that compiles in any form is null', () => {
  assert.equal(syntaxError('return 1', 'a.js'), null);
  assert.equal(syntaxError('figma.root.name', 'a.js'), null);
  assert.equal(syntaxError('(async () => { return 1 })()', 'a.js'), null);
  assert.equal(syntaxError('const x = await figma.getNodeByIdAsync("1");\nreturn x', 'a.js'), null);
});

test('an IIFE with a broken body keeps its own line numbers', () => {
  const se = syntaxError('(async () => {\n  const x = ;\n})()', 'iife.js');
  assert.equal(se.line, 2);
});
