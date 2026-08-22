import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseCliVersion, aboutCredits } from '../dist/lib/about-panel.mjs';

const ESC = String.fromCharCode(27);

describe('parseCliVersion', () => {
  it('reads the bare number Commander prints', () => {
    assert.strictEqual(parseCliVersion('2.1.2\n'), '2.1.2');
  });

  it('survives colour codes', () => {
    assert.strictEqual(parseCliVersion(`${ESC}[32m2.1.2${ESC}[39m\n`), '2.1.2');
  });

  it('takes the last line, not the banner above it', () => {
    assert.strictEqual(parseCliVersion('figma-ds-cli\n\n  2.1.2\n\n'), '2.1.2');
  });

  it('finds the number inside a wordier line', () => {
    assert.strictEqual(parseCliVersion('figma-cli version 2.1.2'), '2.1.2');
  });

  it('keeps a prerelease suffix', () => {
    assert.strictEqual(parseCliVersion('2.2.0-beta.1'), '2.2.0-beta.1');
  });

  it('returns null when the output is not a version', () => {
    // Otherwise the dialog would print a shell error where a number belongs.
    assert.strictEqual(parseCliVersion(''), null);
    assert.strictEqual(parseCliVersion('\n \n'), null);
    assert.strictEqual(parseCliVersion('command not found: figma-cli'), null);
    assert.strictEqual(parseCliVersion('2.1'), null);
  });
});

describe('aboutCredits', () => {
  it('names the CLI version', () => {
    assert.match(aboutCredits('2.1.2'), /^figma-cli 2\.1\.2$/m);
  });

  it('says em dash rather than nothing when there is no version', () => {
    const credits = aboutCredits(null);
    assert.match(credits, /^figma-cli —$/m);
    assert.doesNotMatch(credits, /null/);
  });

  it('states where the UI came from, in both cases', () => {
    for (const credits of [aboutCredits('2.1.2'), aboutCredits(null)]) {
      assert.match(credits, /claude-terminal-panel/);
    }
  });
});
