/**
 * Which command to write into the terminal when the panel needs the CLI.
 *
 * Pure, because the interesting cases are the ones that are tedious to reproduce: the CLI not
 * installed globally, a GUI launch with a stunted PATH, a checkout that only exists on disk.
 */
export interface CliLookup {
  /** Directories from PATH, in order. */
  pathDirs: string[];
  /** Does this absolute path exist and is it executable / readable? */
  exists: (candidate: string) => boolean;
  /** `figmaCli` from panel.json: an explicit command or a path to a checkout. */
  configured?: string;
  /**
   * Repository roots to try when nothing is installed: `repoPath` from ~/.figma-cli/config.json
   * (fig-start writes it) and the app's own parent — FigmaClaude ships inside the CLI repo.
   */
  checkoutDirs?: string[];
}

/** The same lookup as a spawnable command: no shell, no quoting, arguments as an array. */
export interface CliInvocation {
  /** Program to spawn. Empty when nothing usable was found. */
  file: string;
  args: string[];
  source: CliCommand['source'];
  /** The entry script when the CLI runs through node — what the PATH shim has to point at. */
  entry?: string;
}

export interface CliCommand {
  /** What to type. Empty when nothing usable was found. */
  command: string;
  /** How it was found — the caller says so, since "not found" needs different words. */
  source: 'configured' | 'path' | 'checkout' | 'none';
}

const BIN_NAMES = ['figma-cli', 'figma-ds-cli'];

/** Quotes a path for a shell only when it needs it — an unquoted tidy path reads better. */
export function shellPath(value: string): string {
  return /[^\w@%+=:,./-]/.test(value) ? `'${value.replace(/'/g, `'\\''`)}'` : value;
}

function viaNode(entry: string, source: CliCommand['source']): CliInvocation {
  return { file: 'node', args: [entry], source, entry };
}

export function resolveCliInvocation(lookup: CliLookup): CliInvocation {
  const { pathDirs, exists, configured, checkoutDirs = [] } = lookup;

  if (configured) {
    // A checkout rather than a command: run its entry point with node.
    if (configured.endsWith('.js')) {
      return viaNode(configured, 'configured');
    }
    if (configured.includes('/') && exists(`${configured}/src/index.js`)) {
      return viaNode(`${configured}/src/index.js`, 'configured');
    }
    return { file: configured, args: [], source: 'configured' };
  }

  for (const dir of pathDirs) {
    for (const name of BIN_NAMES) {
      if (exists(`${dir}/${name}`)) {
        return { file: name, args: [], source: 'path' };
      }
    }
  }

  // Last resort, and the normal case on a machine where the repo is a checkout: run it in place.
  for (const dir of checkoutDirs) {
    if (!dir) continue;
    const entry = `${dir}/src/index.js`;
    if (exists(entry)) {
      return viaNode(entry, 'checkout');
    }
  }

  return { file: '', args: [], source: 'none' };
}

/** The same answer as a line a shell (or Claude's prompt) can take. */
export function resolveCliCommand(lookup: CliLookup): CliCommand {
  const found = resolveCliInvocation(lookup);
  if (!found.file) {
    return { command: '', source: 'none' };
  }
  const parts = [found.file, ...found.args.map(shellPath)];
  return { command: parts.join(' '), source: found.source };
}
