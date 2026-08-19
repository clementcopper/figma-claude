import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  PATH_MARKER,
  extractProbedPath,
  pathProbeCommand,
  whichOnPath,
  withUserBinDirs
} from '../dist/lib/shell-path.mjs';

describe('pathProbeCommand', () => {
  it('marks its answer so a banner cannot be mistaken for it', () => {
    assert.ok(pathProbeCommand().includes(PATH_MARKER));
    assert.ok(pathProbeCommand().includes('$PATH'));
  });
});

describe('extractProbedPath', () => {
  it('finds the marked line among an interactive shell\'s chatter', () => {
    const out = [
      'Last login: Tue Aug 19',
      'nvm: version 20 in use',
      `${PATH_MARKER}/usr/local/bin:/usr/bin:/bin`,
      ''
    ].join('\n');
    assert.strictEqual(extractProbedPath(out), '/usr/local/bin:/usr/bin:/bin');
  });

  it('takes the last marked line when a shell echoes the command itself', () => {
    const out = `${PATH_MARKER}/first\n${PATH_MARKER}/usr/bin:/bin\n`;
    assert.strictEqual(extractProbedPath(out), '/usr/bin:/bin');
  });

  it('answers null rather than a guess', () => {
    assert.strictEqual(extractProbedPath('no marker here'), null);
    assert.strictEqual(extractProbedPath(`${PATH_MARKER}`), null);
    assert.strictEqual(extractProbedPath(''), null);
  });
});

describe('withUserBinDirs', () => {
  it("adds the places tools live when no shell file mentions them", () => {
    // The case that broke every terminal: claude installs into ~/.local/bin via .zshrc.
    const result = withUserBinDirs('/usr/bin:/bin', '/Users/x');
    assert.ok(result.split(':').includes('/Users/x/.local/bin'));
    assert.ok(result.startsWith('/usr/bin:/bin'), 'the shell\'s own order stays in front');
  });

  it('never duplicates what is already there', () => {
    const path = '/Users/x/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin';
    assert.strictEqual(withUserBinDirs(path, '/Users/x'), path);
  });
});

describe('whichOnPath', () => {
  const withFiles = (...files) => (candidate) => files.includes(candidate);

  it('searches the PATH in order', () => {
    const found = whichOnPath('claude', '/usr/bin:/Users/x/.local/bin', withFiles('/Users/x/.local/bin/claude'));
    assert.strictEqual(found, '/Users/x/.local/bin/claude');
  });

  it('reports nothing found instead of a silent exit 1', () => {
    assert.strictEqual(whichOnPath('claude', '/usr/bin:/bin', withFiles('/opt/claude')), null);
  });

  it('takes a path as given, without searching', () => {
    assert.strictEqual(whichOnPath('/opt/claude', '/usr/bin', withFiles('/opt/claude')), '/opt/claude');
    assert.strictEqual(whichOnPath('/opt/claude', '/usr/bin', withFiles()), null);
  });
});
