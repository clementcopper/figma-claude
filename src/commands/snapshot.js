// Commands: snapshot / check — the deterministic half of the design-system
// workflow.
//
//   figma-cli snapshot   → write design.json, the canonical contract (commit it)
//   figma-cli check      → re-extract, diff against the contract, exit 1 on drift
//
// Neither command involves a model. `check` answers "is the file still what we
// agreed it is?" by comparing numbers, so the verdict is reproducible and
// CI-able rather than something a human has to certify by looking at a
// screenshot.
import chalk from 'chalk';
import ora from 'ora';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, relative } from 'path';
import { program, checkConnection, fastEval } from '../lib/cli-core.js';
import { runExtraction, ExtractionError } from '../lib/extract-run.js';
import {
  buildSnapshot, stableStringify, diffSnapshots, formatDiff, summarizeDiff,
  sameScope, SNAPSHOT_VERSION,
} from '../lib/design-snapshot.js';
import { checkRules } from '../lib/design-rules.js';
import { loadRules, DEFAULT_RULES_DIR } from './rules.js';
import { verifyRoundtrip, formatRoundtripLoss } from '../lib/roundtrip.js';

const DEFAULT_FILE = 'design.json';

/**
 * Show a path relative to the working directory when it lives inside it.
 * Printing the absolute path of a file that sits right here is pure noise, and
 * it is the noisiest line in the whole output.
 */
const show = (p) => {
  const rel = relative(process.cwd(), p);
  return rel && !rel.startsWith('..') ? rel : p;
};

const scopeOf = (options) => ({
  pages: options.pages || null,
  sections: null,
  selection: !!options.selection,
  resolveRemote: !!options.resolveRemote,
});

/** Extract + canonicalize. Shared by both commands so they can never diverge. */
async function takeSnapshot(options, spinner, { auditComponents = false } = {}) {
  const { extraction, droppedVars, remoteStats } = await runExtraction({
    evalFn: fastEval,
    pages: options.pages,
    selection: options.selection,
    resolveRemote: options.resolveRemote,
    auditComponents,
    onProgress: (t) => { if (spinner) spinner.text = t; },
  });
  return {
    snapshot: buildSnapshot(extraction, { scope: scopeOf(options) }),
    extraction,   // the rule + roundtrip checks work on the raw extraction
    droppedVars,
    remoteStats,
    pageCount: extraction.pages.length,
  };
}

/**
 * A snapshot built from an INCOMPLETE extraction would silently become a false
 * contract — every later `check` would compare against data that was never
 * fully read. Surface that loudly rather than writing it as if it were clean.
 */
function completenessWarnings(snapshot, droppedVars) {
  const out = [];
  if (droppedVars) out.push(`${droppedVars} variable(s) could not be read — they are missing from this contract`);
  for (const p of snapshot.pages) {
    if (p.error) out.push(`page "${p.name}" failed to extract: ${p.error}`);
    else if (p.reducedDepth != null) out.push(`page "${p.name}" was captured at reduced depth ${p.reducedDepth} — deeper nodes are not in the contract`);
  }
  return out;
}

/**
 * Human label for an extraction scope. It MUST mention every field that
 * `sameScope` compares — otherwise a mismatch warning can read "taken with
 * whole file, this run used whole file", which tells the user nothing about
 * what actually differs (in that case: --resolve-remote).
 */
const scopeLabel = (s) => {
  if (!s) return 'whole file';
  const base = s.selection ? 'selection'
    : s.pages ? `pages matching ${s.pages.join(', ')}`
    : 'whole file';
  return s.resolveRemote ? `${base} + library primitives` : base;
};

// Exported for tests: the label must stay in sync with what sameScope compares.
export const scopeLabelForTest = scopeLabel;

const addScopeFlags = (cmd) => cmd
  .option('--pages <list>', 'only pages whose name matches one of these (comma list, case-insensitive substring)')
  .option('--selection', 'only the currently selected nodes (overrides --pages)')
  .option('--resolve-remote', 'also capture the library primitives this file aliases into');

addScopeFlags(program
  .command('snapshot [file]')
  .description(`Write ${DEFAULT_FILE} — a canonical, diffable contract of the design system. Commit it, then verify with \`figma-cli check\`.`))
  .action(async (file, options) => {
    await checkConnection();
    const outPath = resolve(file || DEFAULT_FILE);
    const spinner = ora('Reading file info...').start();
    try {
      const { snapshot, droppedVars, pageCount } = await takeSnapshot(options, spinner);

      // If a contract already exists, say what this rewrite actually changes —
      // "updated" with no diff summary is how real drift gets waved through.
      let previous = null;
      if (existsSync(outPath)) {
        try { previous = JSON.parse(readFileSync(outPath, 'utf8')); } catch { previous = null; }
      }

      writeFileSync(outPath, stableStringify(snapshot));
      const varCount = snapshot.variables.reduce((a, c) => a + c.variables.length, 0);
      spinner.succeed(`Snapshot written → ${show(outPath)}`);
      console.log(chalk.gray(`  ${pageCount} page(s), ${varCount} variable(s) across ${snapshot.variables.length} collection(s) · scope: ${scopeLabel(snapshot.meta.scope)}`));

      if (previous) {
        const { equal, diffs, truncated } = diffSnapshots(previous, snapshot);
        if (equal) console.log(chalk.gray('  No change vs the previous snapshot.'));
        else {
          const by = summarizeDiff(diffs);
          console.log(chalk.yellow(`  ${diffs.length}${truncated ? '+' : ''} change(s) recorded: ${Object.entries(by).map(([k, v]) => `${v} in ${k}`).join(', ')}`));
          console.log(chalk.gray('  Review the diff in git before committing.'));
        }
      }

      for (const w of completenessWarnings(snapshot, droppedVars)) console.log(chalk.yellow(`  ⚠ ${w}`));
      console.log(chalk.gray(`\n  Commit ${file || DEFAULT_FILE}, then verify anytime: figma-cli check`));
      process.exit(0);
    } catch (e) {
      spinner.fail(e instanceof ExtractionError ? e.message : `Snapshot failed: ${e.message}`);
      process.exit(1);
    }
  });

addScopeFlags(program
  .command('check [file]')
  .description(`Verify the open file against its contracts: drift vs ${DEFAULT_FILE}, per-component rules, and a lossless-roundtrip proof. Exits 1 on any failure — no model involved, so it works in CI.`))
  .option('--limit <n>', 'max differences to print', '40')
  .option('--json', 'machine-readable output')
  .option('--rules <dir>', `directory of component contracts (default: ${DEFAULT_RULES_DIR}/)`)
  .option('--no-rules', 'skip the per-component rule checks')
  .option('--roundtrip', 'also prove the token layer survives extract → DESIGN.md → import')
  .option('--only <part>', 'run just one part: snapshot | rules | roundtrip')
  .action(async (file, options) => {
    const only = options.only ? String(options.only).toLowerCase() : null;
    if (only && !['snapshot', 'rules', 'roundtrip'].includes(only)) {
      console.error(chalk.red(`✗ --only must be one of: snapshot, rules, roundtrip (got "${options.only}")`));
      process.exit(1);
    }
    const wants = (part) => (only ? only === part : true);

    const inPath = resolve(file || DEFAULT_FILE);
    const rulesDir = resolve(options.rules || DEFAULT_RULES_DIR);
    const hasSnapshot = existsSync(inPath);
    // `--no-rules` sets options.rules to false in commander; treat that and an
    // absent directory the same way.
    const rulesEnabled = options.rules !== false && wants('rules');
    const loaded = rulesEnabled ? loadRules(rulesDir) : { rules: [], errors: [] };
    const doSnapshot = wants('snapshot') && hasSnapshot;
    const doRules = rulesEnabled && (loaded.rules.length > 0 || loaded.errors.length > 0);
    const doRoundtrip = only === 'roundtrip' || (options.roundtrip && wants('roundtrip'));

    if (!doSnapshot && !doRules && !doRoundtrip) {
      // Nothing to verify against — say which artifact is missing rather than
      // exiting 0 and implying everything is fine.
      if (only === 'snapshot' || (!only && !hasSnapshot && !loaded.rules.length)) {
        console.error(chalk.red(`✗ No ${file || DEFAULT_FILE} found.`), `Create one first: ${chalk.bold('figma-cli snapshot')}`);
        if (!only) console.error(chalk.gray(`  (or add per-component contracts with \`figma-cli rules gen\`)`));
      } else if (only === 'rules') {
        console.error(chalk.red(`✗ No contracts in ${rulesDir}/.`), `Create them first: ${chalk.bold('figma-cli rules gen')}`);
      }
      process.exit(1);
    }

    let committed = null;
    if (doSnapshot) {
      try {
        committed = JSON.parse(readFileSync(inPath, 'utf8'));
      } catch (e) {
        console.error(chalk.red(`✗ ${show(inPath)} is not readable JSON:`), e.message);
        process.exit(1);
      }
      if (committed.version !== SNAPSHOT_VERSION) {
        console.error(chalk.red(`✗ Snapshot format v${committed.version}, this CLI writes v${SNAPSHOT_VERSION}.`));
        console.error(chalk.gray('  Regenerate it with `figma-cli snapshot` and review the diff once.'));
        process.exit(1);
      }
    }

    await checkConnection();
    const spinner = options.json ? null : ora('Reading file info...').start();
    try {
      // The rule layer needs every variant measured, so the audit runs whenever
      // contracts are being enforced.
      const { snapshot, droppedVars, extraction } = await takeSnapshot(options, spinner, { auditComponents: doRules });
      const limit = Math.max(1, parseInt(options.limit, 10) || 40);
      const warnings = completenessWarnings(snapshot, droppedVars);
      const out = { ok: true, parts: {}, warnings };

      // ---- part 1: drift vs the committed snapshot
      let snapResult = null;
      if (doSnapshot) {
        const { equal, diffs, truncated } = diffSnapshots(committed, snapshot, { limit });
        const scopeMismatch = !sameScope(committed.meta?.scope, snapshot.meta.scope);
        snapResult = { equal, diffs, truncated, scopeMismatch };
        out.parts.snapshot = { ok: equal, diffs, truncated, scopeMismatch };
        if (!equal) out.ok = false;
      }

      // ---- part 2: per-component rule contracts
      let ruleResult = null;
      if (doRules) {
        ruleResult = checkRules(loaded.rules, extraction);
        out.parts.rules = {
          ok: ruleResult.pass && !loaded.errors.length,
          checked: ruleResult.checked,
          failed: ruleResult.failed,
          errors: loaded.errors,
          reports: ruleResult.reports,
        };
        if (!ruleResult.pass || loaded.errors.length) out.ok = false;
      }

      // ---- part 3: lossless roundtrip proof
      let rtResult = null;
      if (doRoundtrip) {
        if (spinner) spinner.text = 'Verifying roundtrip…';
        rtResult = verifyRoundtrip(extraction);
        out.parts.roundtrip = rtResult;
        if (!rtResult.ok) out.ok = false;
      }

      if (options.json) {
        console.log(JSON.stringify(out, null, 2));
        process.exit(out.ok ? 0 : 1);
      }

      if (out.ok) spinner.succeed('All contracts hold');
      else spinner.fail('Contract violated');

      // ---- report: snapshot
      if (snapResult) {
        if (snapResult.equal) {
          console.log(chalk.green('  ✓ snapshot: ') + chalk.gray(`matches ${show(inPath)} · ${snapshot.pages.length} page(s), ${snapshot.variables.reduce((a, c) => a + c.variables.length, 0)} variable(s), scope ${scopeLabel(snapshot.meta.scope)}`));
        } else {
          const by = summarizeDiff(snapResult.diffs);
          console.log(chalk.red(`  ✗ snapshot: ${snapResult.diffs.length}${snapResult.truncated ? '+' : ''} difference(s) vs ${show(inPath)} — `) + chalk.gray(Object.entries(by).map(([k, v]) => `${v} in ${k}`).join(', ')));
          for (const d of snapResult.diffs) {
            const line = formatDiff(d);
            console.log('      ' + (d.kind === 'added' ? chalk.green(line) : d.kind === 'removed' ? chalk.red(line) : chalk.yellow(line)));
          }
          if (snapResult.truncated) console.log(chalk.gray(`      … capped at ${limit}. Raise it with --limit.`));
        }
      }

      // ---- report: rules
      if (ruleResult) {
        const good = ruleResult.checked - ruleResult.failed;
        if (ruleResult.pass && !loaded.errors.length) {
          console.log(chalk.green('  ✓ rules: ') + chalk.gray(`${good}/${ruleResult.checked} contract(s) hold`));
        } else {
          console.log(chalk.red(`  ✗ rules: ${ruleResult.failed} of ${ruleResult.checked} contract(s) violated`));
          for (const rep of ruleResult.reports) {
            if (rep.pass) continue;
            console.log(chalk.bold(`      ${rep.component}`));
            for (const r of rep.results) {
              if (r.ok) continue;
              console.log('        ' + chalk.red('✗ ') + r.msg);
            }
          }
        }
        for (const e of loaded.errors) console.log(chalk.red(`      ✗ ${e.file}: ${e.message}`));
      }

      // ---- report: roundtrip
      if (rtResult) {
        if (rtResult.skipped) console.log(chalk.gray(`  – roundtrip: skipped (${rtResult.reason})`));
        else if (rtResult.ok) console.log(chalk.green('  ✓ roundtrip: ') + chalk.gray(`all ${rtResult.varCount} token(s) across ${rtResult.collections} collection(s) survive extract → DESIGN.md → import`));
        else {
          console.log(chalk.red(`  ✗ roundtrip: ${rtResult.losses.length} token(s) do NOT survive extract → DESIGN.md → import`));
          for (const l of rtResult.losses.slice(0, limit)) console.log('      ' + chalk.red(formatRoundtripLoss(l)));
          if (rtResult.losses.length > limit) console.log(chalk.gray(`      … and ${rtResult.losses.length - limit} more`));
          console.log(chalk.gray('      This is the "tokens re-import white" failure mode. Try --resolve-remote.'));
        }
      }

      // A scope mismatch is the #1 cause of a confusing red run: comparing a
      // one-page extraction against a whole-file contract reports every other
      // page as deleted. Call it out explicitly instead of letting the user
      // chase phantom drift.
      if (snapResult?.scopeMismatch) {
        console.log(chalk.yellow(`\n  ⚠ Scope mismatch: the contract was taken with "${scopeLabel(committed.meta?.scope)}", this run used "${scopeLabel(snapshot.meta.scope)}".`));
        console.log(chalk.gray('    Re-run with the same flags, or re-snapshot at the new scope.'));
      }
      for (const w of warnings) console.log(chalk.yellow(`  ⚠ ${w}`));

      if (!out.ok) {
        if (snapResult && !snapResult.equal) console.log(chalk.gray('\n  If the change was intended: figma-cli snapshot   (then review the git diff)'));
        if (ruleResult && !ruleResult.pass) console.log(chalk.gray('  If a contract itself is wrong: edit the YAML in ' + show(rulesDir) + '/, or regenerate with `figma-cli rules gen --force`'));
        process.exit(1);
      }
      process.exit(0);
    } catch (e) {
      if (spinner) spinner.fail(e instanceof ExtractionError ? e.message : `Check failed: ${e.message}`);
      else console.error(JSON.stringify({ ok: false, error: e.message }));
      process.exit(1);
    }
  });
