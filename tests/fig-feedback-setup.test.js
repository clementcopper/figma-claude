import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// bin/fig-feedback-setup against a throwaway HOME. The panel's MCP file is seeded with a key, so
// step 6 skips the keychain and never prompts; nothing outside the temp HOME is written.
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'fig-feedback-setup');
const homes = [];
after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });

function runSetup({ claudeMd, claudeJson, settings }) {
  const home = mkdtempSync(join(tmpdir(), 'fig-setup-'));
  homes.push(home);
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.figma-ds-cli'), { recursive: true });
  writeFileSync(join(home, '.figma-ds-cli', 'mcp-framelink.json'), JSON.stringify({
    mcpServers: { framelink: { command: 'npx', args: ['-y', 'figma-developer-mcp', '--stdio'],
                               env: { FIGMA_API_KEY: 'figd_test' } } },
  }));
  if (claudeMd !== undefined) writeFileSync(join(home, '.claude', 'CLAUDE.md'), claudeMd);
  if (claudeJson !== undefined) writeFileSync(join(home, '.claude.json'), JSON.stringify(claudeJson));
  if (settings !== undefined) writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(settings));
  // Without NODE_TEST_CONTEXT: the script runs `node -e` for its JSON edits, and a child that
  // inherits it reports to this runner instead of doing the edit.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const out = execFileSync('bash', [SCRIPT], {
    env: { ...env, HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 30000,
  });
  return { out, home, claudeMd: () => readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8'),
           settings: () => JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')) };
}

describe('fig-feedback-setup step 7: the tool-choice rule', () => {
  it('appends the rule once to a CLAUDE.md that has none', () => {
    const r = runSetup({ claudeMd: '# CLAUDE.md\n' });
    assert.strictEqual(r.claudeMd().match(/^## .*Framelink (oder|or) figma-cli/gm).length, 1);
  });

  it('leaves a CLAUDE.md alone that carries the rule in English', () => {
    // ~/.claude/CLAUDE.md is kept in English, so the section was translated by hand; the German
    // marker missed it and a rerun appended a second, German copy.
    const md = '# CLAUDE.md\n\n## Reading Figma: Framelink or figma-cli\n\nFramelink reads.\n';
    const r = runSetup({ claudeMd: md });
    assert.doesNotMatch(r.claudeMd(), /Figma lesen/);
    assert.match(r.out, /already carries the tool-choice rule/);
  });
});

describe('fig-feedback-setup step 6: a Framelink entry the panel would load twice', () => {
  const framelink = (key) => ({ type: 'stdio', command: 'npx',
    args: ['-y', 'figma-developer-mcp', `--figma-api-key=${key}`, '--stdio'] });

  it('names a user-scope entry, and never deletes it', () => {
    const claudeJson = { mcpServers: { Framelink_Figma_MCP: framelink('figd_x') } };
    const r = runSetup({ claudeMd: '# CLAUDE.md\n', claudeJson });
    assert.match(r.out, /Framelink_Figma_MCP/);
    assert.match(r.out, /claude mcp remove Framelink_Figma_MCP -s user/);
    const after = JSON.parse(readFileSync(join(r.home, '.claude.json'), 'utf8'));
    assert.ok(after.mcpServers.Framelink_Figma_MCP, 'someone else\'s configuration stays');
  });

  it('says nothing when only the panel file carries Framelink', () => {
    const r = runSetup({ claudeMd: '# CLAUDE.md\n', claudeJson: { mcpServers: {} } });
    assert.doesNotMatch(r.out, /claude mcp remove/);
  });
});

describe('fig-feedback-setup step 1: the feedback rule', () => {
  it('recognises its own sentence when the file wraps it across two lines', () => {
    // Daniel's CLAUDE.md is reflowed to ~100 columns; the marker then spans a line break
    // ("… not just Business. A\nproject's own LEARNINGS.md does not replace it"), a fixed-string
    // grep missed it and every run appended the sentence again.
    const md = '# CLAUDE.md\n\n## figma-cli Feedback\n\nIt is the only file a panel session may write. A\n'
      + "project's own LEARNINGS.md does not replace it: a friction goes there.\n";
    const r = runSetup({ claudeMd: md });
    assert.strictEqual(r.claudeMd().match(/LEARNINGS\.md does not replace it/g).length, 1);
    assert.match(r.out, /already carries the rule/);
  });
});

describe('fig-feedback-setup step 8: the handoff hook', () => {
  const OURS = ['Figma Claude/Sessions/HANDOFF.md', 'Sessions/HANDOFF.md', 'FigmaClaude/Sessions/HANDOFF.md'];
  const hookCommand = (s) => s.hooks.SessionStart.flatMap((g) => g.hooks).find((h) => h.command.includes('HANDOFF.md')).command;
  const paths = (cmd) => [...cmd.match(/for f in (.*?); do/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const withList = (list) => ({ hooks: { SessionStart: [{ matcher: 'clear', hooks: [{ type: 'command',
    command: `for f in ${list.map((f) => `"${f}"`).join(' ')}; do [ -f "$f" ] && { echo "# Handoff der vorherigen Session ($f) — Stand pruefen, dann fortsetzen:"; cat "$f"; break; }; done; true` }] }] } });

  it('keeps a path the user added and adds none of ours twice', () => {
    // ~/.claude writes its handoff to handoff/HANDOFF.md (sessions/ is Claude Code's own); the
    // rewrite used to drop that path, so a /clear in ~/.claude printed nothing.
    const r = runSetup({ claudeMd: '# x\n', settings: withList(['handoff/HANDOFF.md', ...OURS]) });
    assert.deepStrictEqual(paths(hookCommand(r.settings())), ['handoff/HANDOFF.md', ...OURS]);
    assert.match(r.out, /handoff hook already installed/);
  });

  it('completes an older list without losing the user\'s extra path', () => {
    const r = runSetup({ claudeMd: '# x\n', settings: withList(['handoff/HANDOFF.md', 'FigmaClaude/Sessions/HANDOFF.md']) });
    assert.deepStrictEqual(paths(hookCommand(r.settings())), ['handoff/HANDOFF.md', ...OURS]);
  });

  it('installs our list on a machine without the hook', () => {
    const r = runSetup({ claudeMd: '# x\n', settings: {} });
    assert.deepStrictEqual(paths(hookCommand(r.settings())), OURS);
  });
});
