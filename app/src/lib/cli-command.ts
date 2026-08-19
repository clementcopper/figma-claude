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

export function resolveCliCommand(lookup: CliLookup): CliCommand {
  const { pathDirs, exists, configured } = lookup;

  if (configured) {
    // A checkout rather than a command: run its entry point with node.
    if (configured.endsWith('.js') || configured.endsWith('/src/index.js')) {
      return { command: `node ${shellPath(configured)}`, source: 'configured' };
    }
    if (configured.includes('/') && exists(`${configured}/src/index.js`)) {
      return { command: `node ${shellPath(`${configured}/src/index.js`)}`, source: 'configured' };
    }
    return { command: configured, source: 'configured' };
  }

  for (const dir of pathDirs) {
    for (const name of BIN_NAMES) {
      if (exists(`${dir}/${name}`)) {
        return { command: name, source: 'path' };
      }
    }
  }

  return { command: '', source: 'none' };
}
