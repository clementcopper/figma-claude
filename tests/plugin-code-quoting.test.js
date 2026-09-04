import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Every command module builds Plugin API code as a template literal. A value spliced into a
// quoted string inside that code — `'Variable not found: ${varName}'`, `"${nodeId}"` — breaks
// on the first quote or backslash (`set fill -q "it's"` → SyntaxError, reported as a connection
// failure) and lets a crafted id run statements inside Figma. The safe form is
// `${JSON.stringify(value)}`. This test scans the sources for the unsafe forms so the next one
// fails here, not in a user's file.

const commandsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'commands');

// CLI-side lines print with these; they never build plugin code.
const CLI_OUTPUT = /console\.|chalk|spinner\.|ora\(/;

// Places where a quoted interpolation is not plugin code, and what makes each one safe.
const ALLOWLIST = [
  'node "${scriptPath}"',      // url-tools: shell argv, path from tmpdir() with a fixed name
  'figmaUse(`',                // the figmaUse mini-DSL strips quotes and JSON.stringifies itself
];

// Walk each line once, left to right: a quote opens a string that ends at the next unescaped
// quote of the same kind. A regex that pairs any two quotes reads `'a' in n) x = ${v}; return '`
// as one string and flags code that is fine.
export function unsafeInterpolations(source) {
  const hits = [];
  source.split('\n').forEach((line, i) => {
    if (CLI_OUTPUT.test(line)) return;
    if (ALLOWLIST.some((a) => line.includes(a))) return;
    let pos = 0;
    while (pos < line.length) {
      const q = line[pos];
      if (q !== "'" && q !== '"') { pos++; continue; }
      let end = pos + 1;
      while (end < line.length && line[end] !== q) end += line[end] === '\\' ? 2 : 1;
      if (end >= line.length) break;                      // unterminated on this line: skip
      const body = line.slice(pos + 1, end);
      const m = body.match(/\$\{([^}]+)\}/);
      if (m && !m[1].trim().startsWith('JSON.stringify') && !body.includes('`')) {
        hits.push(`${i + 1}: ${q}${body}${q}`);
      }
      pos = end + 1;
    }
  });
  return hits;
}

describe('plugin code quoting', () => {
  for (const file of readdirSync(commandsDir).filter((f) => f.endsWith('.js')).sort()) {
    it(`${file} splices no raw value into a quoted string`, () => {
      const hits = unsafeInterpolations(readFileSync(join(commandsDir, file), 'utf8'));
      assert.deepStrictEqual(hits, [], `use \${JSON.stringify(value)} instead:\n  ${hits.join('\n  ')}`);
    });
  }

  it('recognises the two unsafe shapes and the safe one', () => {
    assert.strictEqual(unsafeInterpolations("const x = `'Not found: ${id}'`;").length, 1);
    assert.strictEqual(unsafeInterpolations('const x = `n.name = "${name}";`;').length, 1);
    assert.strictEqual(unsafeInterpolations("const x = `'Not found: ' + ${JSON.stringify(id)}`;").length, 0);
    assert.strictEqual(unsafeInterpolations("console.log(`'${a}'`)").length, 0);
  });
});
