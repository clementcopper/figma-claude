/**
 * Deciding which rule files `init-agent` writes, and whether it may.
 *
 * Split out of the command so the interesting cases can be unit-tested without a filesystem:
 * a foreign file of the same name (never clobbered), our own file that is merely outdated
 * (rewritten), and the per-tool target paths.
 *
 * The target for Claude Code is `.claude/rules/figma-cli.md`, NOT `AGENTS.md`. Claude Code reads
 * `CLAUDE.md` and the files in `.claude/rules/`; it does not read `AGENTS.md`. Writing the rules
 * there means they load at session start without touching a `CLAUDE.md` the user (or another
 * agent) maintains.
 */

/** Where each tool looks. Relative to the project root. */
export const RULE_TARGETS = {
  claude: '.claude/rules/figma-cli.md',
  agents: 'AGENTS.md',
  cursor: '.cursor/rules/figma-cli.mdc'
};

/** First line of the shared ruleset — how a file is recognised as ours. */
export const RULES_MARKER = '# Using figma-cli';

const CURSOR_FRONTMATTER =
  '---\ndescription: How to drive figma-cli (controls Figma Desktop) from this project\nalwaysApply: true\n---\n\n';

/** Which files a `--tool` value maps to. `both` keeps upstream's meaning: AGENTS.md + Cursor. */
export function toolTargets(tool) {
  switch (String(tool).toLowerCase()) {
    case 'claude': return ['claude'];
    case 'agents': return ['agents'];
    case 'cursor': return ['cursor'];
    case 'both': return ['agents', 'cursor'];
    case 'all': return ['claude', 'agents', 'cursor'];
    default: return null;
  }
}

/** The file content per target: only Cursor needs its frontmatter. */
export function contentFor(target, body) {
  return target === 'cursor' ? CURSOR_FRONTMATTER + body : body;
}

/**
 * The ruleset text, with or without the connection instructions.
 *
 * `--no-setup` drops both places that tell the agent to connect: the sentence up top and the
 * `connect` line in the command list. Everything else — render over eval, never delete the
 * user's nodes, `var:` over hex — is unaffected.
 */
export function assembleRules({ head, setup, rest, noSetup = false }) {
  const body = head + (noSetup ? '' : setup) + rest;
  return noSetup ? body.replace(/^figma-cli connect .*\n/m, '') : body;
}

/**
 * What to do with each target file.
 *
 * @param {object} input
 * @param {string} input.tool             claude | agents | cursor | both | all
 * @param {string} input.body             the ruleset, already assembled
 * @param {Record<string,string|null>} input.existing  path → current content (null = absent)
 * @param {boolean} [input.force]         overwrite a foreign file too
 * @returns {{path:string,content:string,action:'write'|'skip',reason:string}[]|null}
 *   null when the tool name is unknown.
 */
export function planAgentRules({ tool, body, existing = {}, force = false }) {
  const targets = toolTargets(tool);
  if (!targets) return null;

  return targets.map((target) => {
    const path = RULE_TARGETS[target];
    const content = contentFor(target, body);
    const current = existing[path] ?? null;

    if (current === null) return { path, content, action: 'write', reason: 'created' };
    if (current === content) return { path, content, action: 'skip', reason: 'up-to-date' };
    // Ours, but from an older version of the CLI — rewriting it is the point of running again.
    if (current.includes(RULES_MARKER)) return { path, content, action: 'write', reason: 'updated' };
    if (force) return { path, content, action: 'write', reason: 'overwritten' };
    // Somebody else's file that happens to sit at this path. Never clobbered.
    return { path, content, action: 'skip', reason: 'exists' };
  });
}
