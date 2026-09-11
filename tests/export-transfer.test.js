import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Export bytes leave Figma as JSON. As a number array (`Array.from(bytes)`) an 8.6 MB PNG is
// ~30 MB of text serialised once per hop; as base64 it is 11.5 MB in one string. Measured on
// the same frame over the pipe: 13.6 s vs 7.1 s, and leaving the bytes in Figma costs 6.3 s,
// so base64 is within a second of the floor. `verify` and `render --verify` already send
// base64; this keeps the three export commands on the same path and catches the next
// `Array.from(bytes)`.
const commandsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'commands');
const sources = Object.fromEntries(readdirSync(commandsDir).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(join(commandsDir, f), 'utf8')]));

describe('export bytes cross the transport as base64', () => {
  it('no command sends exportAsync bytes as a number array', () => {
    const offenders = Object.entries(sources)
      .flatMap(([file, src]) => src.split('\n').map((line, i) => ({ file, line: i + 1, text: line })))
      .filter(({ text }) => /Array\.from\(bytes\)/.test(text))
      .map(({ file, line }) => `${file}:${line}`);
    assert.deepEqual(offenders, []);
  });

  it('every exportAsync site that returns bytes encodes them with figma.base64Encode', () => {
    for (const [file, src] of Object.entries(sources)) {
      const exportsBytes = (src.match(/await (?:node|target|f)\.exportAsync\(/g) || []).length;
      const encodes = (src.match(/figma\.base64Encode\(bytes\)/g) || []).length;
      assert.ok(encodes >= exportsBytes, `${file}: ${exportsBytes} exportAsync sites, ${encodes} base64Encode calls`);
    }
  });
});
