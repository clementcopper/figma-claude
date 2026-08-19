/**
 * Where FigmaClaude puts things in a user's project.
 *
 * Two places, and the split matters:
 *
 * - **Instructions** go to `.claude/rules/figma-cli.md`. Claude Code reads `CLAUDE.md` and the
 *   files in `.claude/rules/`, and *not* `AGENTS.md` — the panel wrote the wrong file until this
 *   was checked against the docs. A rules file also means no `CLAUDE.md` the user (or another
 *   agent) maintains is ever opened, let alone edited; deleting the file removes the rules again.
 * - **Generated files** go to `FigmaClaude/` — `extract`'s DESIGN.md and its structure trees,
 *   contracts from `rules gen`, exports. In a real project that is half a megabyte of tool output
 *   which otherwise sits between the user's own documents.
 *
 * Visible, not `.figmaclaude/`: the CLI's own `locateDesignMd` scans the working directory plus
 * one level of subdirectories and skips dot-directories, so a hidden folder would make DESIGN.md
 * invisible to `spec` and `instantiate`.
 */

/** Folder for everything the CLI generates in a project. */
export const OUTPUT_DIR = 'FigmaClaude';

/** Where the agent rules live, relative to the project root. */
export const RULES_FILE = '.claude/rules/figma-cli.md';

/** First line of the ruleset — how the file is recognised as the CLI's. */
export const RULES_MARKER = '# Using figma-cli';

/** Is the ruleset in place? Content, not existence: an empty or foreign file is not ours. */
export function rulesInstalled(content: string | null | undefined): boolean {
  return typeof content === 'string' && content.includes(RULES_MARKER);
}

/** A path inside the output folder, for the commands that take one. */
export function outputPath(...segments: string[]): string {
  return [OUTPUT_DIR, ...segments].join('/');
}
