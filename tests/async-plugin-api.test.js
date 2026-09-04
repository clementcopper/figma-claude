import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// The plugin runs with `documentAccess: dynamic-page`, where the synchronous lookups throw
// (`figma.getNodeById`, `figma.variables.getVariableById`, `getLocalVariables`,
// `getLocalVariableCollections`). Four commands still used them, each inside a try/catch that
// swallowed the throw: `sizes` reported "Failed" after the components already existed,
// `tokens components` printed "with variables" without a single binding, `var visualize`
// drew every alias grey.

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'commands');
const SYNC = /\b(getNodeById|getVariableById|getLocalVariables|getLocalVariableCollections|getVariableCollectionById)\(/g;

describe('command modules use the async Plugin API lookups', () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    it(file, () => {
      const hits = [];
      readFileSync(join(dir, file), 'utf8').split('\n').forEach((l, i) => {
        if (SYNC.test(l)) hits.push(`${i + 1}: ${l.trim().slice(0, 90)}`);
        SYNC.lastIndex = 0;
      });
      assert.deepStrictEqual(hits, [], 'use the …Async form');
    });
  }
});
