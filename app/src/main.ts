// Default import, not named: the bundle is CommonJS and `electron` is a CJS module without
// `__esModule`, so esbuild's named-import interop hands back an empty namespace.
import electron from 'electron';
import * as path from 'path';
import { writeFileSync } from 'fs';
import { PtyManager, type PtyEventCallbacks } from './host/ptyManager';
import { ConfigManager } from './host/config';
import { TerminalStateManager } from './host/terminalStateManager';
import { dispatchMessage, type MessageHandlerContext } from './host/messageHandlers';
import { PromptDetector, type PromptDetectorConfig } from './host/promptDetector';
import { StatusLineWatcher } from './host/statusLineWatcher';
import { WORKSPACE_ACCENT_COLORS } from './host/types';
import type { ExtensionMessage, TerminalInstance, WebviewMessage } from './host/types';
import { loadBounds, saveBounds, clampBounds } from './lib/window-bounds';
import { evaluate, FigmaContextWatcher, reconnect, type FigmaSnapshot } from './host/figmaContext';
import {
  clearLastRender,
  ensureShim,
  hasAgentRules,
  isCdpReachable,
  isFigmaRunning,
  listOpenFiles,
  quitFigma,
  readLastRender,
  resolveCli,
  runCli
} from './host/figmaActions';
import type { CliInvocation } from './lib/cli-command';
import {
  describeSelection,
  figmaButtonLabel,
  selectionPromptText,
  statusRows
} from './lib/figma-status';
import { RULES_FILE } from './lib/project-layout';
import {
  buildUndoEval,
  parseLastRender,
  undoLabel,
  undoMessage,
  type UndoResult
} from './lib/render-undo';
import type { BrowserWindow as BrowserWindowType } from 'electron';

const { app, BrowserWindow, dialog, ipcMain, globalShortcut, nativeImage, screen } = electron;

// Before anything else: `app.setName` decides the name in the menu bar, in `~/Library` paths
// and in notifications. In a packaged build the bundle's Info.plist owns the Dock name; while
// running from source it says "Electron" no matter what, so the Dock icon is set explicitly
// below to make the window at least recognisable during development.
app.setName('FigmaClaude');

// dist/main.cjs → the app directory. CommonJS output, so `__dirname` is the honest way.
declare const __dirname: string;
const APP_ROOT = path.dirname(__dirname);

/** Figma's debug port, the same env override the CLI honours. */
const CDP_PORT = Number(process.env.FIGMA_PORT ?? 9222);

/**
 * Wraps text in the bracketed paste markers so a multi-line insert stays one input.
 * Ported unchanged: without them every `\n` reads as Enter.
 */
function bracketedPaste(text: string): string {
  if (!text.includes('\n')) {
    return text;
  }
  return `\x1b[200~${text}\x1b[201~`;
}

/**
 * The host side of the panel — a port of the extension's ClaudeTerminalViewProvider with
 * VS Code removed. Tabs, PTYs, prompt detection and the status line behave identically;
 * what VS Code supplied (a webview, a workspace, an editor) is supplied by Electron here.
 */
class PanelHost implements MessageHandlerContext {
  private window: BrowserWindowType | undefined;
  private disposed = false;
  private isRestarting = false;
  private lastCols = 80;
  private lastRows = 24;

  private readonly configManager = new ConfigManager();
  private readonly stateManager = new TerminalStateManager();
  private readonly ptyManager: PtyManager;
  private readonly promptDetector: PromptDetector;
  private readonly statusLineWatcher: StatusLineWatcher;
  private readonly figmaWatcher: FigmaContextWatcher;
  /** One CLI action at a time — each of them restarts the daemon or Figma underneath. */
  private figmaBusy = false;
  private cliCache: CliInvocation | undefined;

  constructor() {
    const callbacks: PtyEventCallbacks = {
      onData: this.handlePtyData.bind(this),
      onExit: this.handlePtyExit.bind(this),
      onError: this.handlePtyError.bind(this)
    };
    this.ptyManager = new PtyManager(callbacks, APP_ROOT);

    this.promptDetector = new PromptDetector(
      this.getPromptDetectorConfig(),
      this.handleNotificationChange.bind(this)
    );

    this.statusLineWatcher = new StatusLineWatcher((terminalId, snapshot) => {
      this.postMessage({ type: 'statusLine', id: terminalId, data: snapshot });
    });

    // Where the editor context used to go: what VS Code knew about the open file, this knows
    // about the open Figma file — same row, same click-to-insert behaviour.
    this.figmaWatcher = new FigmaContextWatcher((snapshot) => {
      this.sendFigmaContext(snapshot);
    });
  }

  attach(window: BrowserWindowType): void {
    this.window = window;
    // Before the first terminal: locating the CLI also writes the PATH shim, and a PTY only
    // reads its environment at spawn time.
    this.cli();
  }

  // --- MessageHandlerContext ---

  handleReady(cols: number, rows: number): void {
    this.lastCols = cols;
    this.lastRows = rows;
    this.sendFigmaContext(this.figmaWatcher.snapshot);
    this.figmaWatcher.start();

    // Ask for the working directory once, before the first tab exists. Claude Code keeps its
    // session history per directory, so starting in the wrong one means `--resume` offers the
    // wrong conversations — and the tab would have to be thrown away anyway.
    if (!this.configManager.getConfig().cwd) {
      void this.promptForWorkingDirectory({ startTerminal: true });
      return;
    }

    this.createTerminal();
  }

  handleInput(id: string, data: string): void {
    this.ptyManager.write(id, data);
    this.promptDetector.onUserInput(id);
  }

  handleResize(id: string, cols: number, rows: number): void {
    this.lastCols = cols;
    this.lastRows = rows;
    this.ptyManager.resize(id, cols, rows);
  }

  handleNewTab(): void {
    this.createTerminal();
  }

  handleNewTabWithCommand(): void {
    // The VS Code QuickPick has no equivalent yet; a plain tab is the honest fallback.
    this.createTerminal();
  }

  handleCloseTab(id: string): void {
    this.closeTerminal(id);
  }

  handleSwitchTab(id: string): void {
    this.switchToTerminal(id);
  }

  /**
   * Writes the current Figma selection into the active tab's input — without a newline, so
   * sending it stays the user's decision. Ids, not just names: those are what `figma-cli get`,
   * `set` and `render --parent` take.
   */
  handleInsertEditorReference(): void {
    const text = selectionPromptText(this.figmaWatcher.snapshot.selection);
    if (!text) {
      return;
    }
    this.insertIntoActiveTerminal(text);
  }

  handleOpenFile(_id: string, _filePath: string, _line?: number, _column?: number): void {
    // Opening files belongs to an editor. Left inert rather than guessing an app.
  }

  // --- Working directory ---

  /** Directory new tabs start in: the active tab's, else the configured one, else home. */
  currentCwd(): string {
    const activeId = this.stateManager.getActiveId();
    const fromTab = activeId ? this.stateManager.get(activeId)?.cwd : undefined;
    return fromTab ?? this.configManager.getConfig().cwd ?? '';
  }

  broadcastCwd(): void {
    this.postMessage({ type: 'panelCwd', cwd: this.currentCwd() } as unknown as ExtensionMessage);
  }

  /**
   * Opens the directory picker. Cancelling is a real answer: on startup it means "just start
   * somewhere" (home), later it means "leave the tab where it is".
   */
  async promptForWorkingDirectory(options: { startTerminal: boolean }): Promise<void> {
    const current = this.currentCwd();
    const result = await dialog.showOpenDialog({
      title: 'Working directory for Claude',
      message: 'Claude Code keeps its session history per directory.',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: current || undefined,
      buttonLabel: 'Use this folder'
    });

    const chosen = result.canceled ? undefined : result.filePaths[0];

    if (chosen) {
      this.configManager.update({ cwd: chosen });
    }

    if (options.startTerminal) {
      this.createTerminal(chosen);
      return;
    }

    if (chosen) {
      this.moveActiveTerminal(chosen);
    }
  }

  /** Restarts the active tab in another directory — the process cannot be moved, only replaced. */
  private moveActiveTerminal(cwd: string): void {
    const activeId = this.stateManager.getActiveId();
    if (!activeId) {
      this.createTerminal(cwd);
      return;
    }

    const instance = this.stateManager.get(activeId);
    if (instance) {
      instance.cwd = cwd;
    }

    this.isRestarting = true;
    this.postMessage({ type: 'clear', id: activeId });
    this.ptyManager.kill(activeId);
    setTimeout(() => {
      this.isRestarting = false;
    }, 100);

    this.ptyManager.spawn(activeId, this.configManager.getConfig(), this.lastCols, this.lastRows, cwd);
    this.sendTabsUpdate();
    this.broadcastCwd();
    // The status row belongs to the old directory now. Claude re-renders it only after its
    // first output, so seed it from the new directory's remembered snapshot right away.
    this.sendInitialStatusLine(activeId, cwd);
  }

  // --- Terminals ---

  createTerminal(explicitCwd?: string): string {
    const id = this.stateManager.generateId();
    const name = this.stateManager.generateName();
    const config = this.configManager.getConfig();
    const { path: cwd, folderIndex } = this.ptyManager.selectWorkingDirectory(
      explicitCwd ?? config.cwd
    );

    const instance: TerminalInstance = {
      id,
      name,
      pty: undefined,
      isActive: false,
      workspaceFolderIndex: folderIndex,
      cwd
    };

    this.stateManager.set(id, instance);
    this.stateManager.setActive(id);

    this.postMessage({ type: 'createTab', id, name, accentColor: this.getAccentColor(folderIndex) });
    this.sendTabsUpdate();
    this.sendInitialStatusLine(id, cwd);

    this.ptyManager.spawn(id, config, this.lastCols, this.lastRows, cwd);
    this.postMessage({ type: 'switchTab', id });
    this.broadcastCwd();

    return id;
  }

  closeTerminal(terminalId: string): void {
    const instance = this.stateManager.get(terminalId);
    if (!instance) return;

    this.ptyManager.kill(terminalId);
    this.promptDetector.removeTerminal(terminalId);
    this.statusLineWatcher.removeTerminal(terminalId);
    this.stateManager.delete(terminalId);
    this.postMessage({ type: 'removeTab', id: terminalId });

    if (this.stateManager.getActiveId() === terminalId) {
      this.handleActiveTerminalClosed();
      return;
    }

    this.sendTabsUpdate();
  }

  private handleActiveTerminalClosed(): void {
    const remaining = this.stateManager.getAll();
    if (remaining.length > 0) {
      this.switchToTerminal(remaining[remaining.length - 1].id);
      this.sendTabsUpdate();
      return;
    }
    this.stateManager.clearActive();
    this.createTerminal();
  }

  switchToTerminal(terminalId: string): void {
    if (!this.stateManager.get(terminalId)) return;
    this.stateManager.setActive(terminalId);
    this.postMessage({ type: 'switchTab', id: terminalId });
    this.sendTabsUpdate();
    this.broadcastCwd();
  }

  switchToNextTerminal(): void {
    const ids = this.stateManager.getAllIds();
    if (ids.length <= 1) return;
    const currentIndex = ids.indexOf(this.stateManager.getActiveId() ?? '');
    this.switchToTerminal(ids[(currentIndex + 1) % ids.length]);
  }

  switchToPreviousTerminal(): void {
    const ids = this.stateManager.getAllIds();
    if (ids.length <= 1) return;
    const currentIndex = ids.indexOf(this.stateManager.getActiveId() ?? '');
    this.switchToTerminal(ids[(currentIndex - 1 + ids.length) % ids.length]);
  }

  restart(): void {
    this.respawnActive([]);
  }

  resumeActiveTerminal(): void {
    this.respawnActive(['--resume']);
  }

  continueActiveTerminal(): void {
    this.respawnActive(['--continue']);
  }

  closeActiveTerminal(): void {
    const activeId = this.stateManager.getActiveId();
    if (activeId) {
      this.closeTerminal(activeId);
    }
  }

  /**
   * Kills the active tab's process and starts it again in the tab's own directory.
   * Without that cwd the new PTY falls back elsewhere, which silently changes which
   * session history applies.
   */
  private respawnActive(extraArgs: string[]): void {
    const activeId = this.stateManager.getActiveId();
    if (!activeId) return;

    this.isRestarting = true;
    this.postMessage({ type: 'clear', id: activeId });
    this.ptyManager.kill(activeId);

    setTimeout(() => {
      this.isRestarting = false;
    }, 100);

    const config = this.configManager.getConfig();
    const cwd = this.stateManager.get(activeId)?.cwd;
    const spawnConfig =
      extraArgs.length > 0 ? { ...config, args: [...config.args, ...extraArgs] } : config;
    this.ptyManager.spawn(activeId, spawnConfig, this.lastCols, this.lastRows, cwd);
  }

  /** Writes text into the active tab's input without sending it. */
  insertIntoActiveTerminal(text: string): void {
    const activeId = this.stateManager.getActiveId();
    if (!activeId) return;
    this.ptyManager.write(activeId, bracketedPaste(text));
    this.postMessage({ type: 'focusTerminal' });
  }

  sendFigmaContext(snapshot: FigmaSnapshot): void {
    const { status, file, page, selection } = snapshot;

    // The row exists to be clicked, so it only appears when there is something to insert.
    this.postMessage({
      type: 'editorContext',
      data:
        selection.length > 0
          ? {
              fileName: describeSelection(selection, page),
              relativePath: file ? `${file} · ${page}` : page
            }
          : null
    });

    this.postMessage({
      type: 'panelFigma',
      daemon: status.daemon,
      figma: status.figma,
      mode: status.mode,
      file,
      page,
      label: figmaButtonLabel({ daemon: status.daemon, figma: status.figma, file, page }),
      tooltip: status.tooltip
    } as unknown as ExtensionMessage);
  }

  get figmaSnapshot(): FigmaSnapshot {
    return this.figmaWatcher.snapshot;
  }

  refreshFigmaContext(): void {
    this.figmaWatcher.refresh();
  }

  /**
   * Where figma-cli is, looked up once: it costs a login shell, and it cannot move while the
   * app runs. Writing the PATH shim here too means Claude's terminals get the command as soon
   * as the panel has found it.
   */
  private cli(): CliInvocation {
    if (!this.cliCache) {
      this.cliCache = resolveCli(APP_ROOT, this.configManager.getConfig().figmaCli);
      this.ptyManager.pathPrefix = ensureShim(this.cliCache);
    }
    return this.cliCache;
  }

  /**
   * Everything the CLI does on the user's behalf, gathered for the popover behind the indicator.
   *
   * The rows mirror what `bin/fig-status` prints, the file list is `figma-cli files`, and the
   * actions below run the CLI as a child process — nothing is typed into Claude's terminal.
   */
  async sendFigmaMenu(): Promise<void> {
    const config = this.configManager.getConfig();
    const cli = this.cli();
    const snapshot = this.figmaWatcher.snapshot;
    const cwd = this.currentCwd();

    const [figmaRunning, cdpOk] = await Promise.all([isFigmaRunning(), isCdpReachable(CDP_PORT)]);
    // Listing files needs a live connection; asking without one only costs a timeout.
    const files = snapshot.status.figma === 'ok' ? await listOpenFiles(cli) : [];
    const recorded = parseLastRender(readLastRender());
    const bound = (config.figmaFile ?? '').toLowerCase();

    this.postMessage({
      type: 'panelFigmaMenu',
      busy: this.figmaBusy,
      cliFound: Boolean(cli.file),
      rows: statusRows({ figmaRunning, cdpOk, cdpPort: CDP_PORT, health: snapshot.health }),
      files: files.map((file) => ({
        title: file.title,
        bound: bound ? file.title.toLowerCase().includes(bound) : file.title === snapshot.file
      })),
      mode: config.figmaMode ?? 'yolo',
      undo: { label: undoLabel(recorded), enabled: recorded.length > 0 },
      cwd,
      agentsReady: hasAgentRules(cwd)
    } as unknown as ExtensionMessage);
  }

  /** One action at a time: every one of them restarts the daemon or Figma underneath. */
  private async withBusy(what: () => Promise<string>): Promise<void> {
    if (this.figmaBusy) return;
    this.figmaBusy = true;
    void this.sendFigmaMenu();
    try {
      this.figmaMessage(await what());
    } catch (error) {
      this.figmaMessage(error instanceof Error ? error.message : String(error));
    } finally {
      this.figmaBusy = false;
      this.figmaWatcher.refresh();
      void this.sendFigmaMenu();
    }
  }

  /**
   * Connect, in the order that costs the user the least.
   *
   * The CLI never quits a running Figma — only the user knows whether that is safe — so when the
   * debug port is missing the panel asks and does the quitting itself; `connect` then takes its
   * start-fresh path and brings Figma back with the flag set.
   */
  async runConnect(): Promise<void> {
    await this.withBusy(async () => {
      const mode = this.configManager.getConfig().figmaMode ?? 'yolo';
      const args = mode === 'yolo' ? ['connect'] : ['connect', `--${mode}`];

      if (mode === 'yolo' && !(await isCdpReachable(CDP_PORT)) && (await isFigmaRunning())) {
        const answer = await dialog.showMessageBox({
          type: 'question',
          buttons: ['Restart Figma', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
          message: 'Restart Figma to open the debug port?',
          detail:
            'Figma is running without --remote-debugging-port, which is what the CLI talks to. ' +
            'Save your work first: Figma will be quit and started again.'
        });
        if (answer.response !== 0) return 'Cancelled';
        await quitFigma();
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      const result = await runCli(this.cli(), args, { timeoutMs: 120_000 });
      if (!result.ok && /App Management|permission/i.test(result.stdout + result.stderr)) {
        this.postMessage({ type: 'panelFigmaPermission' } as unknown as ExtensionMessage);
        return 'Patching Figma needs "App Management" for FigmaClaude';
      }
      return result.message || (result.ok ? 'Connected' : 'Connect failed');
    });
  }

  /** Restart the daemon, optionally pinning it to one open file. */
  async restartDaemon(file?: string): Promise<void> {
    await this.withBusy(async () => {
      const pin = file ?? this.configManager.getConfig().figmaFile ?? '';
      const result = await runCli(this.cli(), ['daemon', 'restart'], {
        env: pin ? { FIGMA_FILE: pin } : undefined,
        timeoutMs: 30_000
      });
      // The daemon needs a moment before /health answers; without it the popover reads stale.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return result.ok ? (pin ? `Daemon bound to ${pin}` : 'Daemon restarted') : result.message;
    });
  }

  async stopDaemon(): Promise<void> {
    await this.withBusy(async () => {
      const result = await runCli(this.cli(), ['daemon', 'stop'], { timeoutMs: 15_000 });
      return result.ok ? 'Daemon stopped' : result.message;
    });
  }

  /** Binds the daemon to an open file and keeps Claude's terminals on the same one. */
  async bindFigmaFile(title: string): Promise<void> {
    this.configManager.update({ figmaFile: title });
    await this.restartDaemon(title);
  }

  async setFigmaMode(mode: 'yolo' | 'safe' | 'browser'): Promise<void> {
    this.configManager.update({ figmaMode: mode });
    await this.runConnect();
  }

  /**
   * Removes what the last render created — and only that. The ids come from the CLI's own state
   * file, so nothing on the canvas is searched for, matched by name or guessed at.
   */
  async undoLastRender(): Promise<void> {
    await this.withBusy(async () => {
      const nodes = parseLastRender(readLastRender());
      if (nodes.length === 0) return 'Nothing to undo';
      const result = await evaluate<UndoResult>(buildUndoEval(nodes.map((n) => n.id)), 20_000);
      clearLastRender();
      return undoMessage(result);
    });
  }

  /** `init-agent` in the directory Claude actually runs in — the active tab's, not the repo's. */
  async prepareWorkingDirectory(): Promise<void> {
    const cwd = this.currentCwd();
    if (!cwd) {
      await this.promptForWorkingDirectory({ startTerminal: false });
      return;
    }
    await this.withBusy(async () => {
      // `claude`, not `both`: Claude Code reads .claude/rules/, never AGENTS.md. `--no-setup`
      // drops the "run connect once per session" line — connecting is a button here.
      const result = await runCli(this.cli(), ['init-agent', '--tool', 'claude', '--no-setup'], {
        cwd,
        timeoutMs: 15_000
      });
      return result.ok ? `Rules written to ${RULES_FILE}` : result.message;
    });
  }

  /** A line under the actions in the popover — where a terminal would have printed it. */
  private figmaMessage(text: string): void {
    if (!text) return;
    this.postMessage({ type: 'panelFigmaMessage', text } as unknown as ExtensionMessage);
  }

  /** Full screen or not — the bar reserves space for the traffic lights only when they exist. */
  sendWindowState(fullScreen: boolean): void {
    this.postMessage({ type: 'panelWindow', fullScreen } as unknown as ExtensionMessage);
  }

  /** A short message in place of the file name, for a couple of seconds. */
  private toast(text: string): void {
    this.postMessage({ type: 'panelToast', text } as unknown as ExtensionMessage);
  }

  dispose(): void {
    this.disposed = true;
    this.figmaWatcher.stop();
    this.ptyManager.killAll();
    this.promptDetector.dispose();
    this.statusLineWatcher.dispose();
  }

  // --- PTY events ---

  private handlePtyData(terminalId: string, data: string): void {
    if (!this.disposed && this.window) {
      this.postMessage({ type: 'output', id: terminalId, data });
      this.promptDetector.onData(terminalId, data);
    }
  }

  private handlePtyExit(terminalId: string, exitCode: number): void {
    if (!this.disposed && this.window && !this.isRestarting) {
      this.postMessage({
        type: 'output',
        id: terminalId,
        data: `\r\n[Process exited with code ${String(exitCode)}]\r\n`
      });
    }
  }

  private handlePtyError(terminalId: string, error: string): void {
    this.postMessage({
      type: 'output',
      id: terminalId,
      data: `\r\nError starting terminal: ${error}\r\n`
    });
  }

  // --- Helpers ---

  private getPromptDetectorConfig(): PromptDetectorConfig {
    return { enabled: true, showDelay: 300, customPatterns: [] };
  }

  /**
   * Fills the status line the moment a tab exists. Claude Code only runs the statusLine
   * command once it renders, which is after its first output, so without this the row would
   * appear several seconds late — and change the terminal height while the user is typing.
   */
  private sendInitialStatusLine(terminalId: string, cwd: string | undefined): void {
    const snapshot = this.statusLineWatcher.getInitialSnapshot(cwd);
    if (snapshot) {
      this.postMessage({ type: 'statusLine', id: terminalId, data: snapshot });
    }
  }

  private handleNotificationChange(terminalId: string, isWaiting: boolean): void {
    this.stateManager.setWaitingForInput(terminalId, isWaiting);
    this.postMessage({ type: 'setNotification', id: terminalId, show: isWaiting });
  }

  private getAccentColor(folderIndex: number | undefined): string | undefined {
    if (folderIndex === undefined) {
      return undefined;
    }
    return WORKSPACE_ACCENT_COLORS[folderIndex % WORKSPACE_ACCENT_COLORS.length];
  }

  private postMessage(message: ExtensionMessage): void {
    // A PTY keeps producing output for a moment after the window is gone; sending into a
    // disposed frame throws ("Render frame was disposed before WebFrameMain could be
    // accessed") once per chunk, which buries whatever really went wrong.
    const window = this.window;
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      return;
    }
    try {
      window.webContents.send('panel:message', message);
    } catch {
      // The render frame can be gone a moment before `isDestroyed()` admits it, and a PTY
      // keeps producing output meanwhile — one throw per chunk otherwise.
    }
  }

  private sendTabsUpdate(): void {
    this.postMessage({ type: 'tabsUpdate', tabs: this.stateManager.getTabsInfo() });
  }
}

// --- Electron shell ---

/** Actions of the top bar — the four the extension contributed to the view title, plus cwd. */
interface ToolbarMessage {
  type: 'toolbar';
  action:
    | 'newTab'
    | 'resume'
    | 'continue'
    | 'restart'
    | 'pickCwd'
    | 'requestCwd'
    | 'figma';
}

const host = new PanelHost();

function handleToolbarAction(action: ToolbarMessage['action']): void {
  switch (action) {
    case 'newTab':
      host.createTerminal();
      break;
    case 'resume':
      host.resumeActiveTerminal();
      break;
    case 'continue':
      host.continueActiveTerminal();
      break;
    case 'restart':
      host.restart();
      break;
    case 'pickCwd':
      void host.promptForWorkingDirectory({ startTerminal: false });
      break;
    case 'requestCwd':
      host.broadcastCwd();
      host.sendFigmaContext(host.figmaSnapshot);
      break;
    case 'figma':
      // Opening the menu, not an action: what the button used to do is one entry inside it.
      void host.sendFigmaMenu();
      break;
  }
}

/** The popover behind the Figma indicator — every figma-cli action the user needs. */
interface FigmaMenuMessage {
  type: 'figmaMenu';
  action:
    | 'refresh'
    | 'connect'
    | 'daemonRestart'
    | 'daemonStop'
    | 'bindFile'
    | 'setMode'
    | 'undo'
    | 'initAgent'
    | 'openPermissions';
  value?: string;
}

function handleFigmaMenuAction(message: FigmaMenuMessage): void {
  switch (message.action) {
    case 'refresh':
      void host.sendFigmaMenu();
      break;
    case 'connect':
      void host.runConnect();
      break;
    case 'daemonRestart':
      void host.restartDaemon();
      break;
    case 'daemonStop':
      void host.stopDaemon();
      break;
    case 'bindFile':
      if (message.value) void host.bindFigmaFile(message.value);
      break;
    case 'setMode':
      if (message.value === 'yolo' || message.value === 'safe' || message.value === 'browser') {
        void host.setFigmaMode(message.value);
      }
      break;
    case 'undo':
      void host.undoLastRender();
      break;
    case 'initAgent':
      void host.prepareWorkingDirectory();
      break;
    case 'openPermissions':
      // macOS 13+: patching another app is gated behind App Management, and the pane is deep.
      void electron.shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles'
      );
      break;
  }
}

function createWindow(): BrowserWindowType {
  const bounds = clampBounds(loadBounds(), screen.getAllDisplays().map((d) => d.workArea));

  const window = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 240,
    title: 'FigmaClaude',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 10, y: 11 },
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // macOS hides the traffic lights in full screen, which leaves 62 px of reserved space with
  // nothing in it. The bar is told, so it can give that space back.
  const sendWindowState = () => {
    if (window.isDestroyed()) return;
    host.sendWindowState(window.isFullScreen());
  };
  window.on('enter-full-screen', sendWindowState);
  window.on('leave-full-screen', sendWindowState);

  const persist = () => {
    if (!window.isDestroyed() && !window.isMinimized()) {
      saveBounds(window.getBounds());
    }
  };
  window.on('resized', persist);
  window.on('moved', persist);
  // Coming back to the panel is exactly when its picture of Figma is most likely stale.
  window.on('focus', () => {
    host.refreshFigmaContext();
  });

  // A renderer error would otherwise be invisible: the window just stays empty.
  window.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`[renderer] ${message} (${source}:${String(line)})`);
  });

  // PANEL_DEBUG: read the terminal's geometry out of the page once it has settled. Row height
  // against container height is what decides whether the last line is cut off, and guessing at
  // that from a screenshot is how an afternoon disappears.
  if (process.env.PANEL_DEBUG) {
    setTimeout(() => {
      void window.webContents
        .executeJavaScript(`(() => {
          const wrapper = document.querySelector('.terminal-wrapper');
          const screen = document.querySelector('.xterm-screen');
          const rows = document.querySelectorAll('.xterm-rows > div').length;
          const status = document.getElementById('status-line');
          const style = wrapper ? getComputedStyle(wrapper) : null;
          return {
            wrapperClient: wrapper ? wrapper.clientHeight : null,
            padTop: style ? style.paddingTop : null,
            padBottom: style ? style.paddingBottom : null,
            screenHeight: screen ? screen.clientHeight : null,
            rows,
            rowHeight: screen && rows ? +(screen.clientHeight / rows).toFixed(2) : null,
            statusHeight: status ? +status.getBoundingClientRect().height.toFixed(1) : null,
            columnHeight: document.getElementById('terminal-column')?.clientHeight ?? null,
            figmaDisabled: document.querySelector('.toolbar-figma')?.disabled ?? null,
            trafficLightGap: document.querySelector('.toolbar-trafficlights')?.clientWidth ?? null,
            fullScreen: document.body.classList.contains('is-fullscreen')
          };
        })()`)
        .then((metrics) => {
          console.log('[metrics]', JSON.stringify(metrics));
        });
    }, 8000);

  }
  window.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] gone:', details.reason);
  });

  window.once('ready-to-show', () => {
    window.show();
    sendWindowState();

    // Development aid: PANEL_CAPTURE=<file> writes a PNG of the window once it has drawn.
    // Checking the UI otherwise means being at the machine, which makes remote iteration
    // guesswork.
    const capturePath = process.env.PANEL_CAPTURE;
    if (capturePath) {
      setTimeout(() => {
        void window.webContents.capturePage().then((image) => {
          writeFileSync(capturePath, image.toPNG());
          console.log('[panel] captured', capturePath);
        });
      }, Number(process.env.PANEL_CAPTURE_DELAY ?? 2500));
    }
  });

  void window.loadFile(path.join(APP_ROOT, 'index.html'));
  return window;
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    const icon = nativeImage.createFromPath(path.join(APP_ROOT, 'build', 'icon.png'));
    if (!icon.isEmpty()) {
      app.dock.setIcon(icon);
    }
  }

  const window = createWindow();
  host.attach(window);

  ipcMain.on('panel:message', (_event, message: WebviewMessage | ToolbarMessage | FigmaMenuMessage) => {
    // The top bar is ours, not the extension's: its actions are intercepted before the
    // ported dispatcher sees them, which only knows the webview protocol.
    if (message.type === 'toolbar') {
      handleToolbarAction(message.action);
      return;
    }
    if (message.type === 'figmaMenu') {
      handleFigmaMenuAction(message);
      return;
    }
    dispatchMessage(message, host);
  });

  // The shortcuts the extension registered as VS Code commands.
  globalShortcut.register('CommandOrControl+Alt+C', () => {
    if (window.isVisible() && window.isFocused()) {
      window.hide();
    } else {
      window.show();
      window.focus();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      host.attach(createWindow());
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  host.dispose();
});

app.on('window-all-closed', () => {
  app.quit();
});
