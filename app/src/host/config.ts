import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TerminalConfig } from './types';

/**
 * Configuration, ported from the VS Code extension's ConfigManager.
 *
 * VS Code kept these in `settings.json` under `claudeTerminal.*`. There is no settings UI
 * here, so the same keys live in a JSON file next to the CLI's own state. Same names, same
 * defaults — a config from the extension can be pasted in unchanged.
 */
export const CONFIG_FILE = path.join(os.homedir(), '.figma-ds-cli', 'panel.json');

const DEFAULTS: TerminalConfig = {
  command: 'claude',
  args: [],
  autoRun: true,
  shell: '',
  env: {},
  directMode: true,
  cwd: '',
  preloadHelp: false,
  statusLine: true,
  statusLineProvider: 'bundled',
  statusLineCompactBudget: 0,
  editorContext: true
};

export class ConfigManager {
  private cached: TerminalConfig | undefined;

  getConfig(): TerminalConfig {
    if (this.cached) {
      return this.cached;
    }
    this.cached = { ...DEFAULTS, ...this.readFile() };
    return this.cached;
  }

  /** Persists a partial change and drops the cache. Used by the working-directory picker. */
  update(patch: Partial<TerminalConfig>): TerminalConfig {
    const merged = { ...this.getConfig(), ...patch };
    try {
      fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 });
    } catch (error) {
      console.error('[panel] could not write config:', error);
    }
    this.cached = merged;
    return merged;
  }

  invalidateCache(): void {
    this.cached = undefined;
  }

  private readFile(): Partial<TerminalConfig> {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return typeof raw === 'object' && raw !== null ? (raw as Partial<TerminalConfig>) : {};
    } catch {
      // No file yet, or unreadable — defaults then.
      return {};
    }
  }
}
