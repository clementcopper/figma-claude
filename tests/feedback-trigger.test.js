import { describe, it } from 'node:test';
import assert from 'node:assert';
import { shouldRemind, isFigmaCliInvocation, looksFailed } from '../src/lib/feedback-trigger.js';

const payload = (command, response, extra = {}) => ({
  session_id: 's1',
  tool_name: 'Bash',
  tool_input: { command },
  tool_response: response,
  ...extra
});

describe('the false positive that produced this module', () => {
  it('stays silent for a file whose CONTENTS mention figma-cli and ⚠', () => {
    // Reported from the panel minutes after the hook was installed (FEEDBACK.md): the notes file
    // documents earlier findings, so the payload carried both words. Exit 0, nothing wrong.
    const notes = 'figma-cli render warned: ⚠ no text style for 43px Medium — see FEEDBACK.md';
    assert.strictEqual(shouldRemind(payload('tail -14 /Users/danielmartin/Website/LEARNINGS.md', { stdout: notes })), false);
  });

  it('stays silent for a diff of FEEDBACK.md itself', () => {
    const diff = '+- [ ] `cli` · **✗ something failed**\n+  **Repro:** figma-cli duplicate 1:2';
    assert.strictEqual(shouldRemind(payload('git diff FEEDBACK.md', { stdout: diff })), false);
  });

  it('stays silent for a grep for the word', () => {
    assert.strictEqual(
      shouldRemind(payload('grep -rn "figma-cli" LEARNINGS.md', { stdout: 'LEARNINGS.md:12: figma-cli ✗' })),
      false
    );
  });
});

describe('isFigmaCliInvocation', () => {
  it('recognises the program, however it is spelled', () => {
    for (const command of [
      'figma-cli status',
      'figma-ds-cli render "<Frame/>"',
      '/usr/local/bin/figma-cli connect',
      'node src/index.js config list',
      'node /Users/danielmartin/figma-cli/src/index.js eval "1"',
      'FIGMA_PORT=9333 figma-cli connect',
      'cd /tmp && figma-cli status',
      'npx figma-cli docs',
      'bin/fig-status'
    ]) {
      assert.ok(isFigmaCliInvocation(command), command);
    }
  });

  it('refuses the name as a mere argument', () => {
    for (const command of [
      'tail -14 LEARNINGS.md',
      'grep figma-cli notes.md',
      'cat /Users/danielmartin/figma-cli/FEEDBACK.md',
      'ls /Users/danielmartin/figma-cli',
      'git log --oneline -- src/commands/figma-cli.js',
      'echo "run figma-cli next"',
      'node build.mjs'
    ]) {
      assert.ok(!isFigmaCliInvocation(command), command);
    }
  });

  it('handles an empty or missing command', () => {
    assert.ok(!isFigmaCliInvocation(''));
    assert.ok(!isFigmaCliInvocation(undefined));
  });
});

describe('looksFailed', () => {
  it('catches the CLI markers and Commander errors', () => {
    assert.ok(looksFailed({ stdout: '✗ Could not instantiate' }));
    assert.ok(looksFailed({ stdout: '⚠ no text style for 43px Medium' }), 'exit 0 with a warning is the important case');
    assert.ok(looksFailed({ stderr: "error: unknown command 'list'" }));
    assert.ok(looksFailed('Error: spawnSync /bin/sh ETIMEDOUT'));
  });

  it('catches the tool-level signals', () => {
    assert.ok(looksFailed({ stdout: '', is_error: true }));
    assert.ok(looksFailed({ stdout: '', exit_code: 1 }));
    assert.ok(looksFailed({ stdout: '', interrupted: true }));
  });

  it('stays quiet on success', () => {
    assert.ok(!looksFailed({ stdout: 'Connected to Figma\n  File: m2trust', exit_code: 0 }));
    assert.ok(!looksFailed({ stdout: '✓ Rendered: 16459:410111' }));
    assert.ok(!looksFailed(undefined));
    assert.ok(!looksFailed(''));
  });

  it('does not read "error:" out of the middle of a word', () => {
    assert.ok(!looksFailed({ stdout: 'no_error: false' }), 'underscore is not a boundary');
  });
});

describe('shouldRemind', () => {
  it('fires for a real failing invocation', () => {
    assert.ok(shouldRemind(payload('node src/index.js config list', { stderr: "error: unknown command 'list'" })));
  });

  it('fires for a warning at exit 0', () => {
    assert.ok(shouldRemind(payload('figma-cli render "<Text/>"', { stdout: '⚠ no text style for 43px Medium', exit_code: 0 })));
  });

  it('stays silent when the CLI succeeded', () => {
    assert.strictEqual(shouldRemind(payload('figma-cli status', { stdout: 'Connected to Figma' })), false);
  });

  it('ignores other tools', () => {
    assert.strictEqual(
      shouldRemind({ tool_name: 'Read', tool_input: { command: 'figma-cli x' }, tool_response: { stdout: '✗' } }),
      false
    );
  });

  it('survives a payload it does not recognise', () => {
    assert.strictEqual(shouldRemind(undefined), false);
    assert.strictEqual(shouldRemind({}), false);
    assert.strictEqual(shouldRemind({ tool_input: {} }), false);
  });
});
