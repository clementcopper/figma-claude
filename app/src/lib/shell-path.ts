/**
 * Working out the PATH a terminal should have, and whether a command exists on it.
 *
 * An app launched from the Dock inherits launchd's PATH — `/usr/bin:/bin:/usr/sbin:/sbin` — so
 * the panel asks a shell what a real terminal would have. The subtlety that cost an afternoon:
 * a **login** shell is not enough. zsh reads `.zshenv` and `.zprofile` for a login shell, but
 * `.zshrc` only when it is interactive — and `.zshrc` is where installers put their line. Claude
 * Code's own installer writes `export PATH="$HOME/.local/bin:$PATH"` there, so probing with
 * `zsh -l -c` returned a PATH without `claude` in it, and every tab died with a bare exit code 1.
 *
 * Hence: probe interactively, and read the answer back through a marker, because an interactive
 * shell may print a banner, a version notice or a prompt into the same stream.
 */

/** Wraps the answer so it survives whatever else an interactive shell prints. */
export const PATH_MARKER = '__FIGMACLAUDE_PATH__';

export function pathProbeCommand(): string {
  return `printf '%s%s\\n' '${PATH_MARKER}' "$PATH"`;
}

/** Pulls the PATH back out of the probe's output, ignoring banners around it. */
export function extractProbedPath(stdout: string): string | null {
  const line = stdout
    .split('\n')
    .reverse()
    .find((candidate) => candidate.includes(PATH_MARKER));
  if (!line) return null;
  const value = line.slice(line.indexOf(PATH_MARKER) + PATH_MARKER.length).trim();
  return value.includes('/') ? value : null;
}

/**
 * The directories a user's tools live in even when no shell file mentions them. Appended, never
 * prepended: whatever the shell said comes first, so the user's own order wins.
 */
export function withUserBinDirs(path: string, home: string): string {
  const parts = path.split(':').filter(Boolean);
  for (const dir of [`${home}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin']) {
    if (!parts.includes(dir)) parts.push(dir);
  }
  return parts.join(':');
}

/**
 * Where a bare command name would be found. Returns null when it is nowhere on the PATH — which
 * is worth saying out loud, because the alternative is a terminal that exits 1 in silence.
 */
export function whichOnPath(
  command: string,
  path: string,
  exists: (candidate: string) => boolean
): string | null {
  // Already a path: the shell would not search for it either.
  if (command.includes('/')) return exists(command) ? command : null;

  for (const dir of path.split(':').filter(Boolean)) {
    const candidate = `${dir}/${command}`;
    if (exists(candidate)) return candidate;
  }
  return null;
}
