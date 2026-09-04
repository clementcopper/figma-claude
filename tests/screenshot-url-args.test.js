import { describe, it } from 'node:test';
import assert from 'node:assert';
import { captureWebsiteArgs } from '../src/commands/url-tools.js';

// `screenshot-url` used to build one shell string: `npx … "${url}" …` through execSync.
// A URL containing `"` or `;` ended the quote and ran whatever followed as the user.

describe('captureWebsiteArgs', () => {
  const opts = { width: '1280', height: '800', scale: '2' };

  it('keeps the URL as one argv element, whatever it contains', () => {
    const hostile = 'https://x.example/"; touch /tmp/pwned; #';
    const args = captureWebsiteArgs(hostile, '/tmp/out.png', opts);
    assert.strictEqual(args.filter((a) => a === hostile).length, 1);
    assert.ok(args.every((a) => typeof a === 'string'), 'argv, not a joined string');
  });

  it('spells out the options and adds --full-page only when asked', () => {
    const base = captureWebsiteArgs('https://a.example', '/tmp/out.png', opts);
    assert.deepStrictEqual(base.slice(0, 3), ['--yes', 'capture-website-cli', 'https://a.example']);
    assert.ok(base.includes('--output=/tmp/out.png'));
    assert.ok(base.includes('--width=1280') && base.includes('--height=800') && base.includes('--scale-factor=2'));
    assert.ok(base.includes('--overwrite'));
    assert.ok(!base.includes('--full-page'));
    assert.ok(captureWebsiteArgs('https://a.example', '/tmp/out.png', { ...opts, full: true }).includes('--full-page'));
  });
});
