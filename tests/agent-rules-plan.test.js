import { test } from 'node:test';
import assert from 'node:assert';
import {
  assembleRules,
  contentFor,
  planAgentRules,
  RULE_TARGETS,
  toolTargets
} from '../src/lib/agent-rules-plan.js';

const BODY = '# Using figma-cli\n\nrules go here\n';

test('claude means .claude/rules, not AGENTS.md', () => {
  // Claude Code reads CLAUDE.md and .claude/rules/; AGENTS.md it never loads.
  assert.deepStrictEqual(toolTargets('claude'), ['claude']);
  assert.strictEqual(RULE_TARGETS.claude, '.claude/rules/figma-cli.md');
  assert.strictEqual(RULE_TARGETS.agents, 'AGENTS.md');
});

test('both keeps the meaning it had upstream', () => {
  assert.deepStrictEqual(toolTargets('both'), ['agents', 'cursor']);
  assert.deepStrictEqual(toolTargets('all'), ['claude', 'agents', 'cursor']);
  assert.strictEqual(toolTargets('nonsense'), null);
});

test('only the Cursor file carries frontmatter', () => {
  assert.match(contentFor('cursor', BODY), /^---\ndescription:/);
  assert.strictEqual(contentFor('claude', BODY), BODY);
  assert.strictEqual(contentFor('agents', BODY), BODY);
});

test('writes into an empty project', () => {
  const [step] = planAgentRules({ tool: 'claude', body: BODY });
  assert.strictEqual(step.path, '.claude/rules/figma-cli.md');
  assert.strictEqual(step.action, 'write');
  assert.strictEqual(step.reason, 'created');
});

test('rewrites our own file when the ruleset changed', () => {
  const [step] = planAgentRules({
    tool: 'claude',
    body: BODY,
    existing: { '.claude/rules/figma-cli.md': '# Using figma-cli\n\nolder rules\n' }
  });
  assert.strictEqual(step.action, 'write');
  assert.strictEqual(step.reason, 'updated');
});

test('says nothing to do when the file already matches', () => {
  const [step] = planAgentRules({
    tool: 'claude',
    body: BODY,
    existing: { '.claude/rules/figma-cli.md': BODY }
  });
  assert.strictEqual(step.action, 'skip');
  assert.strictEqual(step.reason, 'up-to-date');
});

test('never clobbers a file somebody else wrote', () => {
  const foreign = '# House rules\n\nnothing to do with figma\n';
  const [step] = planAgentRules({
    tool: 'agents',
    body: BODY,
    existing: { 'AGENTS.md': foreign }
  });
  assert.strictEqual(step.action, 'skip');
  assert.strictEqual(step.reason, 'exists');

  const [forced] = planAgentRules({
    tool: 'agents',
    body: BODY,
    existing: { 'AGENTS.md': foreign },
    force: true
  });
  assert.strictEqual(forced.action, 'write');
  assert.strictEqual(forced.reason, 'overwritten');
});

test('an unknown tool is reported, not guessed at', () => {
  assert.strictEqual(planAgentRules({ tool: 'claude-code', body: BODY }), null);
});

const HEAD = '# Using figma-cli\n\nfigma-cli controls Figma Desktop directly.';
const SETUP = ' Open Figma Desktop, then `figma-cli connect` once per session.';
const REST = '\n\n## Handy commands\n```\nfigma-cli connect                      # connect (yolo)\nfigma-cli render "<Frame/>"            # one frame\n```\n';

test('assembleRules drops both connection instructions, and only those', () => {
  const full = assembleRules({ head: HEAD, setup: SETUP, rest: REST });
  assert.ok(full.includes('once per session'));
  assert.ok(full.includes('figma-cli connect  '));

  const trimmed = assembleRules({ head: HEAD, setup: SETUP, rest: REST, noSetup: true });
  assert.ok(!trimmed.includes('once per session'));
  assert.ok(!/^figma-cli connect /m.test(trimmed));
  // Everything else survives — the rules are the point, the connection is the host's job.
  assert.ok(trimmed.includes('figma-cli render "<Frame/>"'));
  assert.ok(trimmed.includes('controls Figma Desktop directly.'));
});
