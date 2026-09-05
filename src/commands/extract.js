// Command: extract — scan the open Figma file and write a DESIGN.md
import chalk from 'chalk';
import ora from 'ora';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { program, checkConnection, fastEval } from '../lib/cli-core.js';
import {
  danglingAliasNames,
  generateDesignMd, generatePageStructureMd, estimateStructureTokens, ALL_SECTIONS,
} from '../design-extract.js';
import { runExtraction, ExtractionError } from '../lib/extract-run.js';

// Structure trees above this estimated token count get auto-split into
// DESIGN-structure/ so the main DESIGN.md stays loadable in one AI context.
const AUTO_SPLIT_TOKENS = 50_000;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'page';

program
  .command('extract [output]')
  .description('Scan the open Figma file (all pages) and write a DESIGN.md — tokens, structure, component variant matrices. Roundtrips with `figma-cli import`.')
  .option('--sections <list>', `comma list of sections (${ALL_SECTIONS.join(',')})`)
  .option('--pages <list>', 'only pages whose name matches one of these (comma list, case-insensitive substring)')
  .option('--selection', 'only the currently selected nodes (overrides --pages)')
  .option('--split', 'additionally write full per-page trees to DESIGN-structure/')
  .option('--no-split', 'never auto-split, even for huge files (one big DESIGN.md)')
  .option('--resolve-remote', 'also capture the library primitives this file aliases into, so `import` can rebuild the full alias chain instead of empty values')
  .action(async (output, options) => {
    await checkConnection();
    const outPath = resolve(output || 'DESIGN.md');

    let sections;
    if (options.sections) {
      sections = options.sections.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const bad = sections.filter(s => !ALL_SECTIONS.includes(s));
      if (bad.length) {
        console.error(chalk.red(`Unknown section(s): ${bad.join(', ')}`));
        console.error(chalk.gray(`Valid: ${ALL_SECTIONS.join(', ')}`));
        process.exit(1);
      }
    }

    const spinner = ora('Reading file info...').start();
    try {
      const { extraction, droppedVars, remoteStats } = await runExtraction({
        evalFn: fastEval,
        sections,
        pages: options.pages,
        selection: options.selection,
        resolveRemote: options.resolveRemote,
        onProgress: (t) => { spinner.text = t; },
      });
      const { variables } = extraction;
      const results = extraction.pages;

      spinner.text = 'Generating DESIGN.md…';

      // Auto-split: when the structure trees alone would blow any AI context
      // window, move them to DESIGN-structure/ and keep the main file lean.
      // options.split is true (--split), false (--no-split) or undefined (auto).
      const wantsStructure = !sections || sections.includes('structure');
      let autoSplit = false;
      let structTokens = 0;
      if (options.split === undefined && wantsStructure) {
        structTokens = estimateStructureTokens(results);
        autoSplit = structTokens > AUTO_SPLIT_TOKENS;
      }
      const doSplit = options.split === true || autoSplit;

      let mainSections = sections;
      if (autoSplit) {
        // Slim main file: drop the structure section, note where it went.
        mainSections = (sections || ALL_SECTIONS).filter(s => s !== 'structure');
      }
      let md = generateDesignMd(extraction, { sections: mainSections });
      if (autoSplit) {
        md = md.replace('-->\n', `-->\n\n> **Structure trees auto-split** (~${Math.round(structTokens / 1000)}k tokens — too large for one AI context): per-page trees are in \`DESIGN-structure/\`. Use \`--no-split\` to force a single file.\n`);
      }
      // `snapshot` and `rules gen` create their directory; this one died on ENOENT after the
      // whole extraction had run.
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, md);

      const written = [outPath];
      if (doSplit) {
        const splitDir = join(dirname(outPath), 'DESIGN-structure');
        mkdirSync(splitDir, { recursive: true });
        for (const page of results) {
          const f = join(splitDir, `${slug(page.name)}.md`);
          writeFileSync(f, generatePageStructureMd(page));
          written.push(f);
        }
      }

      const failed = results.filter(r => r.error);
      const totalNodes = results.reduce((a, p) => a + (p.nodeCount || 0), 0);
      spinner.succeed(`Extracted ${results.length} page(s), ${totalNodes} nodes → ${outPath}`);
      if (variables.length) {
        const varCount = variables.reduce((a, c) => a + (c.variables?.length || 0), 0);
        console.log(chalk.gray(`  Captured ${varCount} variable(s) across ${variables.length} collection(s) — real token names + modes (see § Variables)`));
        if (droppedVars) console.log(chalk.yellow(`  ⚠ ${droppedVars} variable(s) skipped (chunk too large even at floor) — they're missing from § Variables`));
        if (remoteStats && remoteStats.variables) {
          console.log(chalk.gray(`  + ${remoteStats.variables} library primitive(s) from ${remoteStats.collections} enabled library collection(s) — alias chains stay intact on import`));
          if (remoteStats.truncated) console.log(chalk.yellow('  ⚠ library capture hit its safety cap — some primitives are missing'));
        }
        // Any alias whose target is in no captured collection re-imports as an
        // EMPTY variable (renders white). Cheap to detect here, expensive to
        // debug later, so always say it.
        const dangling = danglingAliasNames(variables);
        if (dangling.length) {
          console.log(chalk.yellow(`  ⚠ ${dangling.length} alias target(s) live in a library that is not part of this export`));
          console.log(chalk.yellow(`    e.g. ${dangling.slice(0, 3).join(', ')}`));
          console.log(options.resolveRemote
            ? chalk.gray('    (the library is not enabled in this file — enable it in Figma, then re-extract)')
            : chalk.gray('    Re-run with --resolve-remote to capture them; otherwise those tokens import with no value.'));
        }
      }
      if (autoSplit) console.log(chalk.gray(`  Structure (~${Math.round(structTokens / 1000)}k tokens) auto-split into DESIGN-structure/ — main file stays AI-context-sized (--no-split to override)`));
      else if (doSplit) console.log(chalk.gray(`  + ${results.length} structure file(s) in DESIGN-structure/`));
      if (failed.length) {
        console.log(chalk.yellow(`  ⚠ ${failed.length} page(s) skipped:`));
        for (const f of failed) console.log(chalk.yellow(`    - ${f.name}: ${f.error}`));
      }
      console.log(chalk.gray(`  Re-import anytime: figma-cli import ${output || 'DESIGN.md'}`));
      // When the daemon is down, fastEval falls back to direct CDP websockets
      // that keep the event loop alive — exit explicitly once the work is done.
      process.exit(0);
    } catch (e) {
      // Preconditions the user can fix ("Nothing selected", "No pages match")
      // read better without the generic prefix.
      spinner.fail(e instanceof ExtractionError ? e.message : `Extraction failed: ${e.message}`);
      process.exit(1);
    }
  });
