import { describe, it } from 'node:test';
import assert from 'node:assert';
import { panelSessionName, SESSION_NAME_PREFIX } from '../dist/lib/session-name.mjs';

describe('panelSessionName', () => {
  it('names the session after the open Figma file', () => {
    const name = panelSessionName({ file: 'Website Redesign', cwd: '/Users/x/Business' });
    assert.strictEqual(name, 'figma-claude:Website Redesign');
  });

  // The daemon reports the browser page title, so the suffix comes along for the ride.
  it('drops the " – Figma" the page title carries', () => {
    assert.strictEqual(
      panelSessionName({ file: 'Icon Set – Figma' }),
      'figma-claude:Icon Set'
    );
  });

  // The first tab after app start spawns before the watcher's first poll returns.
  it('falls back to the working directory while Figma is unknown', () => {
    assert.strictEqual(
      panelSessionName({ file: '', cwd: '/Users/x/Documents/Business' }),
      'figma-claude:Business'
    );
    assert.strictEqual(
      panelSessionName({ cwd: '/Users/x/Documents/Business/' }),
      'figma-claude:Business'
    );
  });

  it('is the bare prefix when neither is known', () => {
    assert.strictEqual(panelSessionName(), SESSION_NAME_PREFIX);
    assert.strictEqual(panelSessionName({}), SESSION_NAME_PREFIX);
    assert.strictEqual(panelSessionName({ file: null, cwd: null }), SESSION_NAME_PREFIX);
    assert.strictEqual(panelSessionName({ file: '   ', cwd: '' }), SESSION_NAME_PREFIX);
  });

  it('does not name a session after the filesystem root', () => {
    assert.strictEqual(panelSessionName({ cwd: '/' }), SESSION_NAME_PREFIX);
  });

  // Claude Code refuses a name that is empty once invisible characters are stripped — so a file
  // name made only of them has to reach the fallback, not produce "figma-claude:".
  it('treats an invisible-only file name as no name at all', () => {
    const invisible = '\u200B\u200B\uFEFF';
    assert.strictEqual(
      panelSessionName({ file: invisible, cwd: '/Users/x/Business' }),
      'figma-claude:Business'
    );
    assert.strictEqual(panelSessionName({ file: invisible }), SESSION_NAME_PREFIX);
  });

  it('strips control characters instead of writing them into the terminal title', () => {
    assert.strictEqual(
      panelSessionName({ file: 'Design\u0007 System' }),
      'figma-claude:Design System'
    );
  });

  it('collapses whitespace runs and newlines', () => {
    assert.strictEqual(
      panelSessionName({ file: 'Design\n  System' }),
      'figma-claude:Design System'
    );
  });

  it('truncates a suffix that would be cut off in the prompt box anyway', () => {
    const long = 'A'.repeat(80);
    const name = panelSessionName({ file: long });
    assert.strictEqual(name, `figma-claude:${'A'.repeat(40)}`);
  });
});
