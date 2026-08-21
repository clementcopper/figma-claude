import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import type { IPty, INodePty, TerminalConfig } from './types';
import { getStatusLineDir } from './statusLineWatcher';
import { pathWithShim } from '../lib/cli-shim';
import { extractProbedPath, pathProbeCommand, whichOnPath, withUserBinDirs } from '../lib/shell-path';

// Bundled to CommonJS for Electron's main process, so the loader's own `require` is what
// pulls in the native module. node-pty has no usable ESM entry point.
declare const require: (id: string) => unknown;

/**
 * PTY lifecycle. Ported from the VS Code extension's PtyManager; the only changes are the
 * ones VS Code forced: no `vscode.workspace.workspaceFolders`, no QuickPick, and the app's
 * own directory instead of `extensionUri`.
 *
 * Single-quotes a path for a POSIX shell. Paths contain spaces on macOS, and Claude Code runs
 * the statusLine command through a shell.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The PATH a real terminal would have. Cached: it costs a shell start, and it cannot change
 * while the app runs. Failure is silent — the inherited PATH is then all there is.
 *
 * `-lic`, not `-lc`: interactive as well as login. zsh reads `.zshrc` only when interactive, and
 * that is where installers put their PATH line — Claude Code's own writes
 * `export PATH="$HOME/.local/bin:$PATH"` there. Probed without `-i`, the answer came back
 * without `claude` on it, and every tab died with a silent exit code 1.
 */
let cachedLoginPath: string | null | undefined;
export function loginShellPath(): string | null {
  if (cachedLoginPath !== undefined) {
    return cachedLoginPath;
  }
  cachedLoginPath = null;
  const shell = process.env.SHELL;
  if (shell && process.platform !== 'win32') {
    try {
      const out = execFileSync(shell, ['-lic', pathProbeCommand()], {
        encoding: 'utf8',
        // An interactive rc file can be slow: version managers, completions, greetings.
        timeout: 8000,
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const probed = extractProbedPath(out);
      if (probed) {
        cachedLoginPath = withUserBinDirs(probed, os.homedir());
      }
    } catch {
      // No shell, or it took too long. Not worth a message.
    }
  }
  return cachedLoginPath;
}

/**
 * Whether this tab runs Claude Code. Flags the panel adds — `--settings`, `-n` — are Claude's
 * own; `gemini`, `aider` and friends would choke on them and exit before printing anything.
 */
function runsClaude(config: TerminalConfig): boolean {
  if (!config.command) return false;
  return path.basename(config.command).replace(/\.(exe|cmd|bat)$/i, '') === 'claude';
}

export interface PtyEventCallbacks {
  onData: (terminalId: string, data: string) => void;
  onExit: (terminalId: string, exitCode: number) => void;
  onError: (terminalId: string, error: string) => void;
}

export interface WorkingDirectorySelection {
  path: string;
  folderIndex: number | undefined;
}

export class PtyManager {
  private nodePty: INodePty | undefined;
  private readonly ptys = new Map<string, IPty>();

  /**
   * Directory prepended to every terminal's PATH — the panel's `figma-cli` shim. Set by the host
   * once the CLI has been located; null when the CLI is genuinely installed and needs no help.
   */
  pathPrefix: string | null = null;

  constructor(
    private readonly callbacks: PtyEventCallbacks,
    /** Directory the app was installed to — holds `resources/panel-statusline.js`. */
    private readonly appRoot: string
  ) {}

  spawn(
    terminalId: string,
    config: TerminalConfig,
    cols: number,
    rows: number,
    cwd?: string,
    /** Display name for the Claude session in this tab — see `withSessionName`. */
    sessionName?: string
  ): void {
    this.kill(terminalId);

    try {
      this.ensureNodePtyLoaded();
      // The bundled status line producer is handed over per session, so nothing in the user's
      // ~/.claude/settings.json has to change.
      const effectiveConfig = this.withSessionName(this.withStatusLineSettings(config), sessionName);
      const { shell, env, cwd: defaultCwd } = this.prepareSpawnOptions(config, terminalId);
      const workingDir = cwd ?? defaultCwd;

      // A command that is not on the PATH we just built exits 1 without printing anything, and
      // the tab shows a bare exit code. Saying which command is missing costs one lookup.
      if (config.directMode && config.command) {
        const found = whichOnPath(config.command, env.PATH ?? '', fs.existsSync);
        if (!found) {
          this.callbacks.onError(
            terminalId,
            `"${config.command}" is not on the PATH this window sees. ` +
              'Set "command" in ~/.figma-ds-cli/panel.json to its full path, or install it where ' +
              'your shell can find it.'
          );
          return;
        }
      }

      const pty = this.createPty(effectiveConfig, shell, cols, rows, workingDir, env);

      this.ptys.set(terminalId, pty);
      this.setupPtyEventHandlers(terminalId, pty);
      this.handleAutoRun(pty, effectiveConfig);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.callbacks.onError(terminalId, errorMessage);
    }
  }

  /**
   * Which directory a new tab starts in. VS Code asked when a workspace had several folders;
   * here the configured directory wins, and the fallback is the home directory. Session history
   * lives per directory, so keeping this stable matters.
   */
  selectWorkingDirectory(configuredCwd = ''): WorkingDirectorySelection {
    const fixed = this.resolveConfiguredCwd(configuredCwd);
    return { path: fixed ?? this.getWorkingDirectory(), folderIndex: undefined };
  }

  private ensureNodePtyLoaded(): void {
    if (!this.nodePty) {
      this.nodePty = require('node-pty') as INodePty;
    }
  }

  private prepareSpawnOptions(
    config: TerminalConfig,
    terminalId: string
  ): { shell: string; env: Record<string, string>; cwd: string } {
    const shell = config.shell || this.getDefaultShell();
    const cwd = this.resolveConfiguredCwd(config.cwd) ?? this.getWorkingDirectory();
    const env = this.buildEnvironment(
      config.env,
      config.statusLine ? { terminalId, config } : undefined,
      config
    );
    return { shell, env, cwd };
  }

  /** Expands a leading `~` and requires the directory to exist. */
  private resolveConfiguredCwd(configuredCwd: string): string | undefined {
    const raw = configuredCwd.trim();
    if (!raw) {
      return undefined;
    }

    const expanded =
      raw === '~' || raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(1)) : raw;

    if (!fs.existsSync(expanded)) {
      console.warn(`[panel] configured cwd does not exist, falling back: ${expanded}`);
      return undefined;
    }

    return expanded;
  }

  /**
   * Adds `--settings` with the bundled status line producer when the tab runs Claude Code.
   *
   * Additional settings for this process only: the user's own configuration stays untouched,
   * and outside the panel their status line keeps behaving exactly as before.
   */
  private withStatusLineSettings(config: TerminalConfig): TerminalConfig {
    if (!config.statusLine || config.statusLineProvider !== 'bundled') {
      return config;
    }
    if (!runsClaude(config)) {
      return config;
    }

    const settings = JSON.stringify({
      statusLine: { type: 'command', command: this.getBundledStatusLineCommand() }
    });

    return { ...config, args: [...config.args, '--settings', settings] };
  }

  /**
   * Gives the session a name Claude Code shows in the prompt box, the `/resume` picker and the
   * terminal title. Without it a panel tab is indistinguishable from the Claude running in a
   * normal terminal, which is the usual setup here.
   *
   * A `-n` the user put in `panel.json` wins — this only fills a gap.
   */
  private withSessionName(config: TerminalConfig, sessionName?: string): TerminalConfig {
    // Only in direct mode: `handleAutoRun` joins the arguments into one shell command with
    // spaces, and a file name like "Design System" would arrive as two arguments.
    if (!sessionName || !config.directMode || !runsClaude(config)) {
      return config;
    }
    if (config.args.some((arg) => arg === '-n' || arg === '--name')) {
      return config;
    }

    return { ...config, args: [...config.args, '-n', sessionName] };
  }

  /**
   * How the producer is started. Electron's own binary runs it, so no `node` on PATH is needed;
   * `ELECTRON_RUN_AS_NODE` sits in the command string rather than the PTY environment, or every
   * Electron app started from that terminal would inherit it.
   */
  private getBundledStatusLineCommand(): string {
    // `.cjs`, not `.js`: this package is `"type": "module"`, and the producer is CommonJS.
    // As a `.js` file it died with "require is not defined in ES module scope" — silently,
    // because Claude Code never shows what its statusLine command printed to stderr.
    const script = path.join(this.appRoot, 'resources', 'panel-statusline.cjs');
    return `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(script)}`;
  }

  /**
   * The user's own statusLine command, so the bundled producer can still run it for its side
   * effects — a context warning, a log, whatever it does besides printing.
   */
  private getUserStatusLineCommand(): string | undefined {
    try {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      const parsed: unknown = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null) {
        return undefined;
      }
      const statusLine = (parsed as { statusLine?: { type?: string; command?: string } })
        .statusLine;
      if (statusLine?.type === 'command' && typeof statusLine.command === 'string') {
        return statusLine.command;
      }
    } catch {
      // No settings file, or not readable — then there is nothing to delegate to
    }
    return undefined;
  }

  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  private getWorkingDirectory(): string {
    return os.homedir();
  }

  private buildEnvironment(
    configEnv: Record<string, string>,
    statusLine?: { terminalId: string; config: TerminalConfig },
    config?: TerminalConfig
  ): Record<string, string> {
    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }

    Object.assign(env, configEnv, {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '1'
    });

    // An app started from the Dock inherits launchd's PATH — /usr/bin:/bin:/usr/sbin:/sbin —
    // which holds neither `claude` nor anything installed by npm or Homebrew. Started from a
    // terminal it inherits that terminal's PATH, so the same build works in one place and not
    // the other. Asking the login shell once settles it.
    const loginPath = loginShellPath();
    if (loginPath) {
      env.PATH = loginPath;
    }

    // Where the panel keeps its `figma-cli` launcher, when the CLI is a checkout rather than an
    // install. Only these terminals see it — nothing global, nothing in the user's shell files.
    if (this.pathPrefix) {
      env.PATH = pathWithShim(env.PATH ?? '', this.pathPrefix);
    }

    // How an agent tells "I am running inside the panel" from "I am in a normal terminal".
    // Set unconditionally: CLAUDE_PANEL_TAB_ID says the same thing but disappears with the
    // status line, and workflows like `pre-compact` need the answer either way.
    env.FIGMACLAUDE = '1';

    // The file the panel bound the daemon to. Without it a command from Claude's terminal talks
    // to whichever file the daemon happened to pick first, which is silently the wrong one when
    // several are open.
    if (config?.figmaFile) {
      env.FIGMA_FILE = config.figmaFile;
    } else {
      delete env.FIGMA_FILE;
    }

    // The statusLine script has no other way to say which tab it belongs to: Claude Code
    // hands it the session data on stdin, and the host only ever sees PTY bytes. These two
    // variables are the whole contract — the script writes <tab id>.json into the directory,
    // the watcher reads it back.
    if (statusLine !== undefined) {
      env.CLAUDE_PANEL_TAB_ID = statusLine.terminalId;
      env.CLAUDE_PANEL_STATUS_DIR = getStatusLineDir();

      if (statusLine.config.statusLineProvider === 'bundled') {
        env.CLAUDE_PANEL_COMPACT_BUDGET = String(statusLine.config.statusLineCompactBudget);
        const delegate = this.getUserStatusLineCommand();
        if (delegate !== undefined) {
          env.CLAUDE_PANEL_DELEGATE = delegate;
        } else {
          delete env.CLAUDE_PANEL_DELEGATE;
        }
      } else {
        delete env.CLAUDE_PANEL_COMPACT_BUDGET;
        delete env.CLAUDE_PANEL_DELEGATE;
      }
    } else {
      delete env.CLAUDE_PANEL_TAB_ID;
      delete env.CLAUDE_PANEL_STATUS_DIR;
      delete env.CLAUDE_PANEL_COMPACT_BUDGET;
      delete env.CLAUDE_PANEL_DELEGATE;
    }

    // ELECTRON_RUN_AS_NODE leaks into every child otherwise, and `claude` would start as a
    // bare Node process instead of the CLI.
    delete env.ELECTRON_RUN_AS_NODE;
    // Remove CI flag so Claude doesn't think it's in CI
    delete env.CI;

    // Session-scoped variables of a Claude Code process that happens to be an ancestor of the
    // panel. Inheriting them makes the new session think it is a child of that one — the
    // visible symptom is "Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION".
    // Configuration variables (CLAUDE_CODE_USE_BEDROCK and friends) are deliberately kept.
    for (const key of [
      'CLAUDECODE',
      'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_CODE_CHILD_SESSION',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_EXECPATH',
      'CLAUDE_CODE_MESSAGING_SOCKET',
      'CLAUDE_CODE_MESSAGING_TOKEN',
      'CLAUDE_PID'
    ]) {
      delete env[key];
    }

    return env;
  }

  private createPty(
    config: TerminalConfig,
    shell: string,
    cols: number,
    rows: number,
    cwd: string,
    env: Record<string, string>
  ): IPty {
    if (!this.nodePty) {
      throw new Error('node-pty not loaded');
    }

    const spawnOptions = { name: 'xterm-256color', cols, rows, cwd, env };

    if (config.directMode && config.command) {
      return this.nodePty.spawn(config.command, config.args, spawnOptions);
    }
    return this.nodePty.spawn(shell, [], spawnOptions);
  }

  private setupPtyEventHandlers(terminalId: string, pty: IPty): void {
    pty.onData((data: string) => {
      this.callbacks.onData(terminalId, data);
    });

    pty.onExit(({ exitCode }) => {
      // Drop the dead process before telling anyone. Its file descriptor is gone, and every
      // later write or resize on it throws from native code — `Error: ioctl(2) failed`, which
      // in the main process means the whole app goes down.
      if (this.ptys.get(terminalId) === pty) {
        this.ptys.delete(terminalId);
      }
      this.callbacks.onExit(terminalId, exitCode);
    });
  }

  private handleAutoRun(pty: IPty, config: TerminalConfig): void {
    if (!config.directMode && config.autoRun && config.command) {
      const fullCommand = [config.command, ...config.args].join(' ');
      pty.write('clear && ' + fullCommand + '\r');
    }
  }

  write(terminalId: string, data: string): void {
    const pty = this.ptys.get(terminalId);
    if (!pty) return;
    try {
      pty.write(data);
    } catch {
      // The process can die between the keystroke and this call; typing into a dead terminal
      // is a no-op, not a reason to bring the window down.
    }
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const pty = this.ptys.get(terminalId);
    if (!pty) return;
    try {
      pty.resize(cols, rows);
    } catch {
      // Same race, and this one is the common path: the UI resizes on every window change and
      // on every status-line height change, so a tab whose process has exited would take the
      // app with it (`ioctl(2) failed`).
    }
  }

  kill(terminalId: string): void {
    const pty = this.ptys.get(terminalId);
    if (pty) {
      try {
        pty.kill();
      } catch {
        // Ignore errors when killing
      }
      this.ptys.delete(terminalId);
    }
  }

  killAll(): void {
    for (const terminalId of this.ptys.keys()) {
      this.kill(terminalId);
    }
  }
}
