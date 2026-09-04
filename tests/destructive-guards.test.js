import { describe, it } from 'node:test';
import assert from 'node:assert';
import { componentsCleanupCode } from '../src/commands/tokens.js';
import { clearChildrenCode } from '../src/commands/gradient.js';
import { deleteAllCode } from '../src/commands/variables.js';

// CLAUDE.md: never delete existing nodes on a user's canvas. Three commands did, with no flag:
// `tokens components` removed every node named Card/Input/Button… on the page, `gradient
// --apply-to` emptied the target frame, and `var delete-all` took every collection — with a
// case-sensitive filter, so a typo in `-c` widened it to everything.

describe('tokens components cleanup', () => {
  it('removes nothing unless --replace is given', () => {
    assert.strictEqual(componentsCleanupCode(['Card'], { replace: false }), null);
  });

  it('with --replace removes only the named nodes, names quoted', () => {
    const code = componentsCleanupCode(['Card', "O'Neil"], { replace: true });
    assert.match(code, /\.remove\(\)/);
    assert.match(code, /"O'Neil"/);
  });
});

describe('gradient --apply-to', () => {
  it('refuses a frame that already has children unless --replace is given', () => {
    const code = clearChildrenCode({ replace: false });
    assert.doesNotMatch(code, /\.remove\(\)/);
    assert.match(code, /--replace/);
    assert.match(code, /throw new Error/);
  });

  it('clears the children with --replace', () => {
    assert.match(clearChildrenCode({ replace: true }), /\.remove\(\)/);
  });
});

describe('var delete-all', () => {
  it('previews without --yes: counts, no remove', () => {
    const code = deleteAllCode({ yes: false });
    assert.doesNotMatch(code, /\.remove\(\)/);
    assert.match(code, /variables/);
  });

  it('deletes with --yes', () => {
    assert.match(deleteAllCode({ yes: true }), /\.remove\(\)/);
  });

  it('matches the collection case-insensitively, like var list does', () => {
    const code = deleteAllCode({ yes: true, collection: 'Shadcn' });
    assert.match(code, /toLowerCase\(\)/);
    assert.match(code, /"shadcn"/, 'the filter is lowercased before it reaches Figma');
  });
});
