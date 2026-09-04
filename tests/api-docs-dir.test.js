import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDocsDir } from '../src/api-docs.js';

// `api setup` cloned into <package>/docs/figma-api: root-owned on a global install (EACCES,
// exit 1). The clone lives under the user's home now; a checkout that already has the old
// location keeps using it.
test('resolveDocsDir prefers an existing legacy clone, else the home directory', () => {
  assert.equal(resolveDocsDir({ legacy: '/repo/docs/figma-api', legacyExists: true, home: '/Users/x' }), '/repo/docs/figma-api');
  assert.equal(resolveDocsDir({ legacy: '/repo/docs/figma-api', legacyExists: false, home: '/Users/x' }), '/Users/x/.figma-cli/figma-api');
});
