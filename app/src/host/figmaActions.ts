/**
 * Running the figma-CLI without a terminal.
 *
 * The panel exists to keep the terminal for Claude, so everything the CLI does on the user's
 * behalf — connecting, the daemon, binding a file, scaffolding the agent rules — runs here as a
 * plain child process: arguments as an array, no shell, output captured and reported in the UI
 * instead of scrolling past Claude's conversation.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveCliInvocation, type CliInvocation } from '../lib/cli-command';
import { pathWithShim, shimDir, shimPath, shimScript } from '../lib/cli-shim';
import { loginShellPath } from './ptyManager';

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, '.figma-ds-cli');

/** Written by `figma-cli render`; the undo button reads it and nothing else. */
export const LAST_RENDER_FILE = path.join(STATE_DIR, 'last-render.json');

/** fig-start stores the checkout here, so a user who ran it once needs no panel setting. */
const FIG_START_CONFIG = path.join(HOME, '.figma-cli', 'config.json');

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** The single line worth showing: the CLI's last meaningful output, or the failure. */
  message: string;
}

function repoPathFromFigStart(): string {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(FIG_START_CONFIG, 'utf8'));
    const value = (raw as { repoPath?: unknown }).repoPath;
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

/**
 * Where the CLI is, in the order that respects the user's own setup: an explicit setting, then an
 * installed binary, then a checkout — the machine this was built on has only the last one.
 */
export function resolveCli(appRoot: string, configured?: string): CliInvocation {
  return resolveCliInvocation({
    pathDirs: (loginShellPath() ?? process.env.PATH ?? '').split(':').filter(Boolean),
    exists: fs.existsSync,
    configured,
    checkoutDirs: [repoPathFromFigStart(), path.dirname(appRoot)]
  });
}

/** The PATH a spawned CLI needs: node lives in the login shell's PATH, not in launchd's. */
function cliEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  const loginPath = loginShellPath();
  if (loginPath) env.PATH = loginPath;
  // Inherited from whatever started the app; it would turn a spawned Electron into plain node.
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/** ANSI colours out, empty lines out: the CLI writes for a terminal, this reads in a popover. */
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*[A-Za-z]', 'g');

function lastLine(text: string): string {
  const lines = text
    .replace(ANSI, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

export function runCli(
  cli: CliInvocation,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}
): Promise<RunResult> {
  if (!cli.file) {
    return Promise.resolve({
      ok: false,
      stdout: '',
      stderr: '',
      message: 'figma-cli not found — set "figmaCli" in ~/.figma-ds-cli/panel.json'
    });
  }

  return new Promise((resolve) => {
    execFile(
      cli.file,
      [...cli.args, ...args],
      {
        cwd: options.cwd,
        env: cliEnv(options.env),
        timeout: options.timeoutMs ?? 20_000,
        maxBuffer: 4 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        const ok = !error;
        resolve({
          ok,
          stdout,
          stderr,
          message: ok
            ? lastLine(stdout)
            : lastLine(stderr) || lastLine(stdout) || (error?.message ?? 'failed')
        });
      }
    );
  });
}

export interface OpenFile {
  title: string;
  id: string;
}

/** The open design files, as `figma-cli files` reports them, with Figma's title suffix removed. */
export async function listOpenFiles(cli: CliInvocation): Promise<OpenFile[]> {
  const result = await runCli(cli, ['files'], { timeoutMs: 10_000 });
  if (!result.ok) return [];
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((file): file is { title?: string; id?: string } => Boolean(file))
      .map((file) => ({
        title: String(file.title ?? '')
          .replace(/\s*[–—-]\s*Figma\s*$/u, '')
          .trim(),
        id: String(file.id ?? '')
      }))
      .filter((file) => file.title !== '');
  } catch {
    return [];
  }
}

/**
 * Writes the `figma-cli` launcher the panel's terminals see on their PATH.
 *
 * Only when the CLI runs through node — a genuinely installed binary is already on PATH, and a
 * shim would shadow the real thing. Returns the directory to prepend, or null when there is
 * nothing to do.
 */
export function ensureShim(cli: CliInvocation): string | null {
  if (!cli.entry) return null;

  const dir = shimDir(HOME);
  const file = shimPath(HOME);
  const wanted = shimScript(cli.entry);
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === wanted) return dir;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, wanted, { mode: 0o755 });
    fs.chmodSync(file, 0o755);
    return dir;
  } catch (error) {
    console.error('[panel] could not write the figma-cli shim:', error);
    return null;
  }
}

export { pathWithShim };

/** A Figma process exists. macOS only — the app ships for macOS, the rest gets an honest false. */
export function isFigmaRunning(): Promise<boolean> {
  if (process.platform !== 'darwin') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('/usr/bin/pgrep', ['-x', 'Figma'], (error, stdout) => {
      resolve(!error && stdout.trim() !== '');
    });
  });
}

/** Quits Figma. Only ever called after the user confirmed it in a dialog. */
export function quitFigma(): Promise<void> {
  return new Promise((resolve) => {
    execFile('/usr/bin/pkill', ['-x', 'Figma'], () => resolve());
  });
}

/** The debug port answers — the one probe that says whether Yolo Mode can work at all. */
export async function isCdpReachable(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/json/version`, {
      signal: AbortSignal.timeout(1500)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** What the last render created, as the state file holds it. */
export function readLastRender(): string {
  try {
    return fs.readFileSync(LAST_RENDER_FILE, 'utf8');
  } catch {
    return '';
  }
}

export function clearLastRender(): void {
  try {
    fs.unlinkSync(LAST_RENDER_FILE);
  } catch {
    // Already gone is the state we wanted.
  }
}

/** Whether `init-agent` has run in this directory. */
export function hasAgentRules(cwd: string): boolean {
  if (!cwd) return false;
  try {
    return fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8').includes('# Using figma-cli');
  } catch {
    return false;
  }
}
