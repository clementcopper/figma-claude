import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveTheme } from '../dist/lib/theme-choice.mjs';

describe('resolveTheme', () => {
  it('follows macOS when set to system', () => {
    assert.strictEqual(resolveTheme({ setting: 'system', systemPrefersDark: true }), 'dark');
    assert.strictEqual(resolveTheme({ setting: 'system', systemPrefersDark: false }), 'light');
  });

  it('lets an explicit choice win over the system', () => {
    assert.strictEqual(resolveTheme({ setting: 'light', systemPrefersDark: true }), 'light');
    assert.strictEqual(resolveTheme({ setting: 'dark', systemPrefersDark: false }), 'dark');
  });

  it('treats a missing or unknown setting as system', () => {
    assert.strictEqual(resolveTheme({ setting: undefined, systemPrefersDark: false }), 'light');
    assert.strictEqual(resolveTheme({ setting: 'sepia', systemPrefersDark: true }), 'dark');
  });
});
