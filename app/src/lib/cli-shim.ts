/**
 * Making `figma-cli` a real command inside the panel's terminals.
 *
 * On a machine where the repo is only a checkout, `figma-cli` is on nobody's PATH — which is
 * exactly what `init-agent` writes into AGENTS.md as the way to drive it. Rather than installing
 * anything globally or editing the user's shell, the panel writes a two-line launcher next to the
 * CLI's own state and puts that directory on the PATH of the terminals it spawns. Nothing outside
 * the panel changes.
 */

/** Quotes a path for `sh` — single quotes, with the one escape that matters inside them. */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Directory the shim lives in, next to the daemon token the CLI already keeps there. */
export function shimDir(home: string): string {
  return `${home}/.figma-ds-cli/bin`;
}

export function shimPath(home: string): string {
  return `${shimDir(home)}/figma-cli`;
}

/**
 * `node` rather than an absolute interpreter: the terminal runs with the login shell's PATH, which
 * is where the user's node lives. An Electron binary would be the wrong one — it is not node.
 */
export function shimScript(entry: string): string {
  return `#!/bin/sh
# Written by FigmaClaude so \`figma-cli\` works in this panel's terminals.
# Points at the checkout below; delete this file to undo.
exec node ${shQuote(entry)} "$@"
`;
}

/** PATH with the shim directory in front, without duplicating it on a second start. */
export function pathWithShim(path: string, dir: string): string {
  const parts = path.split(':').filter(Boolean);
  if (parts[0] === dir) return path;
  return [dir, ...parts.filter((p) => p !== dir)].join(':');
}
