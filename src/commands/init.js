// Command: init — scaffold agent guidance into a designer's project so figma-cli
// "just works" with whichever AI coding tool they use.
// Writes the SAME condensed usage ruleset to, depending on --tool:
//   - .claude/rules/figma-cli.md    (Claude Code — it reads CLAUDE.md and .claude/rules/,
//                                    NOT AGENTS.md; a rules file loads at session start
//                                    without touching a CLAUDE.md somebody else maintains)
//   - AGENTS.md                     (Codex, Cursor and other agents that read it)
//   - .cursor/rules/figma-cli.mdc   (Cursor)
// The CLI binary needs nothing else — it controls Figma Desktop directly, so it
// already runs in any terminal. This just teaches the agent HOW to drive it.
import chalk from 'chalk';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { program } from '../lib/cli-core.js';
import { assembleRules, planAgentRules, toolTargets } from '../lib/agent-rules-plan.js';

// The shared, designer-facing usage rules. Kept tight on purpose — an agent
// needs the operating rules, not the CLI's internals.
const RULES_HEAD = `# Using figma-cli

figma-cli controls **Figma Desktop** directly (no API key). It runs in any
terminal.`;

// Dropped by --no-setup: where a host app owns the connection (the FigmaClaude panel
// connects by button), telling the agent to run `connect` contradicts the project's own
// instructions — and conflicting instructions get resolved arbitrarily.
const RULES_SETUP = ` Open Figma Desktop, then \`figma-cli connect\` once per session.`;

const RULES_REST = `

## Golden rules
1. **Create frames with \`render\` / \`render-batch\`** — they have smart positioning.
   NEVER use \`eval\` to create visual nodes (no positioning, bypasses guards).
2. **"N buttons/cards" = N separate top-level nodes**, not one wrapper frame
   containing N children. Use \`render-batch '[...]'\` or \`shadcn add <c> --count N\`.
3. **Never delete the user's existing nodes.**
4. After creating, **verify**: \`figma-cli verify "<id>" --measure\` (returns a
   screenshot + real w/h so you catch size bugs by numbers, not by eye).

## Design tokens / variables
- Bind colors at creation with \`var:name\`, never raw hex when a system is loaded:
  \`<Frame bg="var:primary"><Text color="var:on-primary">Go</Text></Frame>\`
- Pin a named collection when the user names one: \`render-batch ... --collection figma\`.
- Import a system: \`figma-cli import tailwind.config.js | globals.css | tokens.json\`.
- Export the open file's system: \`figma-cli extract\` → DESIGN.md.

## JSX cheatsheet (render)
- Layout: \`flex="row|col" gap={16} p={24} px py pt pr pb pl justify="center|between" items="center"\`
- Size: \`w={320} h={200} w="fill" w="hug" w="60%"\` (percent resolves vs parent)
- Look: \`bg="#fff" stroke="#000" strokeWidth={2} rounded={12} shadow="..." opacity={0.8}\`
- Text: \`<Text size={14} weight="semibold" color="#000" lineHeight={20} truncate maxLines={2} w="fill">\`
- Icons (real SVG, never emojis): \`<Icon name="lucide:home" size={20} color="var:primary" />\`
- Dividers: a thin child (\`<Frame w={1} bg="var:border" />\`) auto-fills the cross axis.

## Text wrapping (most common bug)
For text to wrap, the parent AND every \`<Text>\` need \`w="fill"\`, and the parent
needs \`flex="col"\` or \`flex="row"\`.

## Recreating a component from an extracted DESIGN.md (hard rule)
Don't read the structure markdown by hand. Use:
- \`figma-cli spec <Component>\` → authoritative variant axes + sample size (compact).
  Build EXACTLY to those axes (e.g. Variant × Size = a Component Set, not one node).
- \`figma-cli spec <Component> --check <nodeId>\` → enforces it (exit 1 on mismatch:
  wrong structure, missing axes, wrong height). Treat non-zero as "not done".

## Handy commands
\`\`\`
figma-cli connect                      # connect to Figma Desktop (yolo)
figma-cli render '<Frame>...</Frame>'  # one frame
figma-cli render-batch '[ "<Frame>", ... ]' --direction row
figma-cli shadcn add button --count 3  # N distinct shadcn primitives
figma-cli node to-component "<id>"     # promote to a component
figma-cli verify "<id>" --measure      # screenshot + dimensions
figma-cli a11y audit                   # contrast / touch / text checks
\`\`\`
`;

program
  .command('init-agent')
  .description('Scaffold agent rules so figma-cli works out of the box in Claude Code, Codex & Cursor')
  .option('--tool <tool>', 'claude | agents | cursor | both | all', 'both')
  .option('--no-setup', 'leave out the "run connect once per session" line (a host app owns the connection)')
  .option('--force', 'overwrite existing figma-cli rule files')
  .action((options) => {
    const cwd = process.cwd();
    // Commander turns --no-setup into setup:false; the default is true.
    const body = assembleRules({
      head: RULES_HEAD,
      setup: RULES_SETUP,
      rest: RULES_REST,
      noSetup: options.setup === false
    });

    const targets = toolTargets(options.tool);
    if (!targets) {
      console.error(chalk.red('✗'), `Unknown --tool "${options.tool}". Use claude, agents, cursor, both or all.`);
      process.exit(1);
    }

    // Read first, decide, then write: the decision is unit-tested in isolation.
    const existing = {};
    for (const step of planAgentRules({ tool: options.tool, body })) {
      const abs = join(cwd, step.path);
      existing[step.path] = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    }

    const steps = planAgentRules({ tool: options.tool, body, existing, force: options.force });

    for (const step of steps) {
      const abs = join(cwd, step.path);
      if (step.action === 'write') {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, step.content);
        console.log(chalk.green(step.reason === 'updated' ? '✓ updated' : '✓ wrote'), step.path);
      } else if (step.reason === 'up-to-date') {
        console.log(chalk.gray('• up-to-date'), step.path);
      } else {
        console.log(chalk.yellow('• exists (use --force to overwrite)'), step.path);
      }
    }

    console.log(chalk.gray('\nDesigners can now ask their agent to build in Figma — it knows the rules.'));
    if (options.setup !== false) {
      console.log(chalk.gray('Next: open Figma Desktop and run `figma-cli connect`.'));
    }
  });
