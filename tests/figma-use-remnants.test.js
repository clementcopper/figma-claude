import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { removeBgExportCode } from '../src/commands/url-tools.js';

// figma-use was dropped in 2.1.1 (CLAUDE.md: "not a dependency, don't reintroduce it"), and
// three commands still shelled out to it: export-jsx / export-storybook in the default mode,
// `remove-bg` (dead: the export never happened, so it always said "Select an image first"),
// and `raw`, a passthrough to a binary that is not there.

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('figma-use is gone for good', () => {
  it('no command shells out to figma-use', () => {
    const hits = [];
    for (const f of readdirSync(join(src, 'commands'))) {
      readFileSync(join(src, 'commands', f), 'utf8').split('\n').forEach((l, i) => {
        if (/npx --yes figma-use|runFigmaUse\(/.test(l)) hits.push(`${f}:${i + 1}`);
      });
    }
    assert.deepStrictEqual(hits, []);
  });

  it('remove-bg exports through the Plugin API, by id or from the selection', () => {
    const byId = removeBgExportCode('1:2');
    assert.match(byId, /getNodeByIdAsync\("1:2"\)/);
    assert.match(byId, /exportAsync/);
    assert.match(byId, /SCALE.*value: 2/);
    const selected = removeBgExportCode(null);
    assert.match(selected, /selection\[0\]/);
    assert.match(selected, /exportAsync/);
  });
});
