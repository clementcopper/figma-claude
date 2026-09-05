// Command: rules — generate and inspect the per-component YAML contracts that
// `figma-cli check` enforces.
//
// Generation is deliberately a DESCRIPTION of what is true today. A human reads
// the generated YAML once (as a git diff), decides it is what was meant, and
// from that moment the contract is enforced by arithmetic instead of by
// opinion. Regenerating is how you record an intentional change.
import chalk from 'chalk';
import ora from 'ora';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve, relative } from 'path';
import { program, checkConnection, fastEval } from '../lib/cli-core.js';
import { runExtraction, ExtractionError } from '../lib/extract-run.js';
import { findComponentSets, generateRule, ruleToYaml, ruleFromYaml, auditFor } from '../lib/design-rules.js';

export const DEFAULT_RULES_DIR = 'rules';

// Paths inside the working directory read better relative — see snapshot.js.
const show = (p) => {
  const rel = relative(process.cwd(), p);
  return rel && !rel.startsWith('..') ? rel : p;
};

const fileSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'component';

/**
 * Load every rule file in a directory. Returns { rules, errors } rather than
 * throwing, so one malformed file cannot hide the verdict for all the others.
 */
export function loadRules(dir) {
  const out = { rules: [], errors: [] };
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    if (!/\.(ya?ml)$/i.test(entry)) continue;
    const p = join(dir, entry);
    try {
      out.rules.push(ruleFromYaml(readFileSync(p, 'utf8'), entry));
    } catch (e) {
      out.errors.push({ file: entry, message: e.message });
    }
  }
  return out;
}

const rulesCmd = program
  .command('rules')
  .description('Per-component YAML contracts (generate, list) enforced by `figma-cli check`');

rulesCmd
  .command('gen [dir]')
  .description(`Generate a contract per component set from the open file (default dir: ${DEFAULT_RULES_DIR}/)`)
  .option('--only <names>', 'comma list of component names to generate (default: all)')
  .option('--pages <list>', 'only pages whose name matches one of these (comma list, case-insensitive substring)')
  .option('--selection', 'only the currently selected nodes (overrides --pages)')
  .option('--resolve-remote', 'also capture the library primitives this file aliases into (needed for token-binding rules)')
  .option('--force', 'overwrite contracts that already exist')
  .action(async (dir, options) => {
    await checkConnection();
    const outDir = resolve(dir || DEFAULT_RULES_DIR);
    const spinner = ora('Reading file info...').start();
    try {
      const { extraction } = await runExtraction({
        evalFn: fastEval,
        pages: options.pages,
        selection: options.selection,
        resolveRemote: options.resolveRemote,
        auditComponents: true,
        onProgress: (t) => { spinner.text = t; },
      });

      let sets = findComponentSets(extraction);
      if (options.only) {
        const want = options.only.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        sets = sets.filter(s => want.some(w => s.node.n.toLowerCase().includes(w)));
      }
      if (!sets.length) {
        spinner.warn(options.only ? `No component set matches "${options.only}".` : 'No component sets found in this file.');
        console.log(chalk.gray('  Contracts are generated per COMPONENT SET (a component with variants).'));
        process.exit(0);
      }

      mkdirSync(outDir, { recursive: true });
      const written = [];
      const skipped = [];
      const used = new Map();
      for (const s of sets) {
        // Component names are not unique across pages; keep colliding files
        // apart instead of silently overwriting one contract with another.
        const base = fileSlug(s.node.n);
        const n = (used.get(base) || 0) + 1;
        used.set(base, n);
        const name = `${base}${n > 1 ? `-${n}` : ''}.yaml`;
        const path = join(outDir, name);
        if (existsSync(path) && !options.force) { skipped.push(name); continue; }
        writeFileSync(path, ruleToYaml(generateRule({ ...s, audit: auditFor(extraction, s.node.n, s.page) })));
        written.push({ name, component: s.node.n });
      }

      spinner.succeed(`${written.length} contract(s) → ${show(outDir)}/`);
      for (const w of written) console.log(chalk.gray(`  ${w.name}  (${w.component})`));
      if (skipped.length) {
        console.log(chalk.yellow(`  ${skipped.length} kept as-is (already exist): ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''}`));
        console.log(chalk.gray('  Use --force to regenerate them from the current file.'));
      }
      if (!options.resolveRemote) {
        console.log(chalk.gray('\n  Tip: if your tokens come from a shared library, re-run with --resolve-remote so token-binding rules can name them.'));
      }
      console.log(chalk.gray('\n  Review the YAML, commit it, then enforce anytime: figma-cli check'));
      process.exit(0);
    } catch (e) {
      spinner.fail(e instanceof ExtractionError ? e.message : `Rule generation failed: ${e.message}`);
      process.exit(1);
    }
  });

rulesCmd
  .command('list [dir]')
  .description(`Show the contracts on disk and what each one enforces (default: ${DEFAULT_RULES_DIR}/)`)
  .action((dir) => {
    const inDir = resolve(dir || DEFAULT_RULES_DIR);
    const { rules, errors } = loadRules(inDir);
    if (!rules.length && !errors.length) {
      console.log(chalk.yellow(`No contracts in ${show(inDir)}/.`), chalk.gray('Create them with `figma-cli rules gen`.'));
      return;
    }
    for (const r of rules) {
      const req = r.require || {};
      const bits = [
        req.variants != null ? `${req.variants} variants` : null,
        req.exhaustive ? 'exhaustive' : null,
        req.tokens ? `tokens: ${Object.entries(req.tokens).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')}` : null,
        req.geometry ? `${Object.keys(req.geometry).length} geometry` : null,
        req.states ? `${req.states.length} state(s)` : null,
      ].filter(Boolean);
      console.log(`${chalk.bold(r.component)}${r.page ? chalk.gray(`  (${r.page})`) : ''}`);
      if (r.axes) console.log(chalk.gray(`  axes: ${Object.entries(r.axes).map(([k, v]) => `${k}=${v.join('|')}`).join('  ')}`));
      if (bits.length) console.log(chalk.gray(`  enforces: ${bits.join(', ')}`));
    }
    for (const e of errors) console.log(chalk.red(`✗ ${e.file}: ${e.message}`));
    if (errors.length) process.exitCode = 1;
    console.log(chalk.gray(`\n${rules.length} contract(s) in ${show(inDir)}/`));
  });
