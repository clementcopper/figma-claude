import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveCliCommand, resolveCliInvocation, shellPath } from '../dist/lib/cli-command.mjs';

const withFiles = (...files) => (candidate) => files.includes(candidate);

describe('resolveCliCommand', () => {
  it('finds the binary on PATH', () => {
    const r = resolveCliCommand({
      pathDirs: ['/usr/bin', '/usr/local/bin'],
      exists: withFiles('/usr/local/bin/figma-cli')
    });
    assert.deepStrictEqual(r, { command: 'figma-cli', source: 'path' });
  });

  it('accepts the package\'s other binary name', () => {
    const r = resolveCliCommand({
      pathDirs: ['/opt/bin'],
      exists: withFiles('/opt/bin/figma-ds-cli')
    });
    assert.strictEqual(r.command, 'figma-ds-cli');
  });

  it('keeps PATH order', () => {
    const r = resolveCliCommand({
      pathDirs: ['/first', '/second'],
      exists: withFiles('/first/figma-cli', '/second/figma-cli')
    });
    assert.strictEqual(r.command, 'figma-cli');
  });

  // The case that started this: the CLI is a checkout, never installed globally.
  it('runs a checkout with node', () => {
    const r = resolveCliCommand({
      pathDirs: [],
      exists: withFiles('/Users/x/figma-cli/src/index.js'),
      configured: '/Users/x/figma-cli'
    });
    assert.deepStrictEqual(r, {
      command: 'node /Users/x/figma-cli/src/index.js',
      source: 'configured'
    });
  });

  it('takes a direct path to the entry point', () => {
    const r = resolveCliCommand({
      pathDirs: [],
      exists: () => false,
      configured: '/Users/x/figma-cli/src/index.js'
    });
    assert.strictEqual(r.command, 'node /Users/x/figma-cli/src/index.js');
  });

  it('takes a plain command name as configured', () => {
    const r = resolveCliCommand({ pathDirs: [], exists: () => false, configured: 'fig' });
    assert.deepStrictEqual(r, { command: 'fig', source: 'configured' });
  });

  it('configuration wins over PATH', () => {
    const r = resolveCliCommand({
      pathDirs: ['/usr/local/bin'],
      exists: withFiles('/usr/local/bin/figma-cli'),
      configured: 'fig'
    });
    assert.strictEqual(r.command, 'fig');
  });

  // Typing a command that does not exist only moves the failure one step along.
  it('reports nothing rather than a command that cannot run', () => {
    const r = resolveCliCommand({ pathDirs: ['/usr/bin'], exists: () => false });
    assert.deepStrictEqual(r, { command: '', source: 'none' });
  });
});

describe('shellPath', () => {
  it('leaves a tidy path alone', () => {
    assert.strictEqual(shellPath('/Users/x/figma-cli/src/index.js'), '/Users/x/figma-cli/src/index.js');
  });

  it('quotes a path with spaces', () => {
    assert.strictEqual(shellPath('/Users/x/my repo/src/index.js'), "'/Users/x/my repo/src/index.js'");
  });

  it('survives a quote in the path', () => {
    assert.strictEqual(shellPath("/Users/x/o'brien/x.js"), "'/Users/x/o'\\''brien/x.js'");
  });
});

describe('resolveCliInvocation', () => {
  it('gives a spawnable command, not a shell line', () => {
    const r = resolveCliInvocation({
      pathDirs: [],
      exists: withFiles('/Users/x/figma-cli/src/index.js'),
      checkoutDirs: ['/Users/x/figma-cli']
    });
    assert.deepStrictEqual(r, {
      file: 'node',
      args: ['/Users/x/figma-cli/src/index.js'],
      source: 'checkout',
      entry: '/Users/x/figma-cli/src/index.js'
    });
  });

  it('prefers an installed binary over a checkout', () => {
    const r = resolveCliInvocation({
      pathDirs: ['/usr/local/bin'],
      exists: withFiles('/usr/local/bin/figma-cli', '/Users/x/figma-cli/src/index.js'),
      checkoutDirs: ['/Users/x/figma-cli']
    });
    assert.deepStrictEqual(r, { file: 'figma-cli', args: [], source: 'path' });
  });

  it('tries the checkout directories in order and skips empty entries', () => {
    const r = resolveCliInvocation({
      pathDirs: [],
      exists: withFiles('/second/src/index.js'),
      checkoutDirs: ['', '/first', '/second']
    });
    assert.strictEqual(r.entry, '/second/src/index.js');
  });

  it('reports nothing found rather than an empty spawn', () => {
    const r = resolveCliInvocation({ pathDirs: ['/usr/bin'], exists: () => false });
    assert.deepStrictEqual(r, { file: '', args: [], source: 'none' });
  });

  it('never quotes for a spawn — the path is one argument', () => {
    const r = resolveCliInvocation({
      pathDirs: [],
      exists: withFiles('/Users/x/my figma/src/index.js'),
      checkoutDirs: ['/Users/x/my figma']
    });
    assert.deepStrictEqual(r.args, ['/Users/x/my figma/src/index.js']);
  });
});

describe('resolveCliCommand via the checkout', () => {
  it('quotes the path for the prompt, unlike the spawn form', () => {
    const r = resolveCliCommand({
      pathDirs: [],
      exists: withFiles('/Users/x/my figma/src/index.js'),
      checkoutDirs: ['/Users/x/my figma']
    });
    assert.deepStrictEqual(r, { command: "node '/Users/x/my figma/src/index.js'", source: 'checkout' });
  });
});
