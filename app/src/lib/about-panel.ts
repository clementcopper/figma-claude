/**
 * What the native About panel says.
 *
 * macOS already has the place for this — the menu bar's first item — and Electron's default menu
 * carries `role: 'about'`, so nothing has to be built. Only the content is missing.
 *
 * Two versions belong in it, not one: the app's, and the figma-cli the panel is actually driving.
 * With `figmaCli` pointing at a checkout, the second is the one that answers "why does the panel
 * behave differently than the terminal" — and it is the half nobody can read off the Dock.
 *
 * Pure, because the parsing is the part that can be wrong: the version comes out of a child
 * process, and a missing CLI, a shell error or a coloured banner all arrive on the same channel.
 */

/** Where the panel's UI comes from. Long enough to be worth stating once, in the one dialog. */
const PROVENANCE = 'A port of nolikzero/claude-terminal-panel, by way of clementcopper.';

/** The CLI writes for a terminal, so its output can carry colour even when it is one word. */
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*[A-Za-z]', 'g');

/**
 * The version out of `figma-cli --version`, or `null` when the output is not one.
 *
 * Commander prints it bare (`2.1.2`), but nothing guarantees that: a wrapper script may add a
 * banner, and a failed spawn puts a shell error on stdout. The last non-empty line is taken and
 * it has to look like a version, otherwise the dialog would show "command not found" as a number.
 */
export function parseCliVersion(stdout: string): string | null {
  const lines = stdout
    .replace(ANSI, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const last = lines[lines.length - 1];
  if (last === undefined) {
    return null;
  }

  const match = /\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/.exec(last);
  return match ? match[0] : null;
}

/**
 * The credits block: the CLI version, then where the UI came from.
 *
 * An em dash rather than a hidden line when there is no version — "figma-cli —" says the panel
 * looked and found nothing, which is the state worth seeing. Omitting the row would read as
 * "there is no CLI involved".
 */
export function aboutCredits(cliVersion: string | null): string {
  return `figma-cli ${cliVersion ?? '—'}\n${PROVENANCE}`;
}
