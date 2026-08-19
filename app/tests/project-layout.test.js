import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  OUTPUT_DIR,
  RULES_FILE,
  outputPath,
  rulesInstalled
} from '../dist/lib/project-layout.mjs';

describe('project layout', () => {
  it('puts the rules where Claude Code actually reads them', () => {
    // Not AGENTS.md: Claude Code reads CLAUDE.md and .claude/rules/, and nothing else.
    assert.strictEqual(RULES_FILE, '.claude/rules/figma-cli.md');
  });

  it('keeps generated files in one visible folder', () => {
    assert.strictEqual(OUTPUT_DIR, 'FigmaClaude');
    // Visible on purpose: the CLI's own DESIGN.md lookup skips dot-directories.
    assert.ok(!OUTPUT_DIR.startsWith('.'));
    assert.strictEqual(outputPath('DESIGN.md'), 'FigmaClaude/DESIGN.md');
    assert.strictEqual(outputPath('rules'), 'FigmaClaude/rules');
  });
});

describe('rulesInstalled', () => {
  it('judges by content, not by a file being there', () => {
    assert.strictEqual(rulesInstalled('# Using figma-cli\n\nrules'), true);
    assert.strictEqual(rulesInstalled('# Someone else\n'), false);
    assert.strictEqual(rulesInstalled(''), false);
    assert.strictEqual(rulesInstalled(null), false);
    assert.strictEqual(rulesInstalled(undefined), false);
  });
});
