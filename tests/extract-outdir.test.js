import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';

// `extract <new-dir>/DESIGN.md` ran the whole extraction and then died on ENOENT; `snapshot`
// and `rules gen` create their directory. The parent is created before the write.

describe('extract creates the output directory', () => {
  it('calls mkdirSync on the parent before writeFileSync(outPath)', () => {
    const src = readFileSync(new URL('../src/commands/extract.js', import.meta.url), 'utf8');
    const mk = src.indexOf('mkdirSync(dirname(outPath), { recursive: true })');
    const wr = src.indexOf('writeFileSync(outPath, md)');
    assert.ok(mk > 0, 'mkdirSync(dirname(outPath)) missing');
    assert.ok(mk < wr, 'mkdir must precede the write');
  });
});
