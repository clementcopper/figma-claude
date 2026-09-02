// Commands: docs — read the usage guide one section at a time.
import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { program } from '../lib/cli-core.js';
import { parseSections, matchSections } from '../lib/doc-sections.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The guide normally sits at the repo root as CLAUDE.md. A checkout that wants
// a short CLAUDE.md for repo instructions moves the guide to
// docs/FIGMA-USAGE.md — that one is checked FIRST, because where it exists it
// is the guide and the root CLAUDE.md is something else.
const GUIDE_CANDIDATES = ['docs/FIGMA-USAGE.md', 'CLAUDE.md'];

// Other markdown in this repo that `docs --file` already splits just as well, and that nobody
// knew was reachable. Reported from the panel: REFERENCE.md carries the most detailed <Text>
// section of any file and was the only one that never learned `align=`, because the reader who
// would have noticed only ever saw the topics from the guide above.
//
// The blurb names what is DIFFERENT, not how big the file is — "30 topics" buys no attention
// from someone who cannot tell whether any of them hold something they do not already have.
const OTHER_GUIDES = [
  { rel: 'REFERENCE.md', has: '<Text> detail (inline runs, entities, whitespace), Safe Mode, advanced examples' }
];

function loadGuide(explicitPath) {
  const candidates = explicitPath ? [explicitPath] : GUIDE_CANDIDATES;
  for (const rel of candidates) {
    const path = rel.startsWith('/') ? rel : join(ROOT, rel);
    if (existsSync(path)) return { path, rel, markdown: readFileSync(path, 'utf8') };
  }
  return null;
}

program
  .command('docs [topic]')
  .description('Print ONE section of the usage guide (no topic = list them). Cheaper than reading the whole guide.')
  .option('-f, --file <path>', 'read a different markdown file')
  .action((topic, options) => {
    const guide = loadGuide(options.file);
    if (!guide) {
      console.error(chalk.red(`Usage guide not found (looked for ${(options.file ? [options.file] : GUIDE_CANDIDATES).join(', ')})`));
      process.exit(1);
    }

    const sections = parseSections(guide.markdown);

    if (!topic) {
      const total = sections.reduce((sum, s) => sum + s.tokens, 0);
      console.log(chalk.bold(`\n  ${guide.rel} — ${sections.length} topics, ~${total} tokens in full\n`));
      for (const s of sections) {
        console.log(`  ${chalk.cyan(s.slug.padEnd(28))} ${chalk.gray(String(s.tokens).padStart(5) + ' tok')}  ${s.heading}`);
      }
      console.log(chalk.gray(`\n  figma-cli docs <topic>   prints one section instead of all ~${total} tokens`));

      // Counted, never written down: a maintained number is a number that drifts.
      for (const other of OTHER_GUIDES) {
        const found = loadGuide(other.rel);
        if (!found) continue;
        const theirs = parseSections(found.markdown);
        if (theirs.length === 0) continue;
        console.log(chalk.gray(`\n  also splittable — ${chalk.cyan(other.rel)}, ${theirs.length} topics: ${other.has}`));
        console.log(chalk.gray(`  figma-cli docs --file ${other.rel} <topic>`));
      }
      // The cheapest route of all, and it was documented nowhere.
      console.log(chalk.gray(`\n  figma-cli <command> --help   the flags of one command, always current\n`));
      return;
    }

    const hits = matchSections(sections, topic);

    if (hits.length === 0) {
      console.error(chalk.yellow(`No topic matches "${topic}".`));
      console.error(chalk.gray('  Available: ') + sections.map((s) => s.slug).join(', '));
      process.exit(1);
    }

    // Several matches: name them instead of guessing which one was meant.
    if (hits.length > 1) {
      console.error(chalk.yellow(`"${topic}" matches ${hits.length} topics — pick one:`));
      for (const s of hits) {
        console.error(`  ${chalk.cyan(s.slug.padEnd(28))} ${chalk.gray(s.tokens + ' tok')}  ${s.heading}`);
      }
      process.exit(1);
    }

    process.stdout.write(hits[0].body);
  });
