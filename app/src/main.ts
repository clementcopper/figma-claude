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
import type { BrowserWindow as BrowserWindowType } from 'electron';

const { app, BrowserWindow, dialog, ipcMain, globalShortcut, screen } = electron;

// dist/main.cjs → the app directory. CommonJS output, so `__dirname` is the honest way.
declare const __dirname: string;
const APP_ROOT = path.dirname(__dirname);

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
  }

  attach(window: BrowserWindowType): void {
    this.window = window;
  }

  // --- MessageHandlerContext ---

  handleReady(cols: number, rows: number): void {
    this.lastCols = cols;
    this.lastRows = rows;
    // No editor here — the row stays empty until the Figma context lands (M4).
    this.postMessage({ type: 'editorContext', data: null });

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

  handleInsertEditorReference(): void {
    // Figma context lands here in M4.
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

  dispose(): void {
    this.disposed = true;
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
    window.webContents.send('panel:message', message);
  }

  private sendTabsUpdate(): void {
    this.postMessage({ type: 'tabsUpdate', tabs: this.stateManager.getTabsInfo() });
  }
}

// --- Electron shell ---

/** Actions of the top bar — the four the extension contributed to the view title, plus cwd. */
interface ToolbarMessage {
  type: 'toolbar';
  action: 'newTab' | 'resume' | 'continue' | 'restart' | 'pickCwd' | 'requestCwd';
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
      break;
  }
}

function createWindow(): BrowserWindowType {
  const bounds = clampBounds(loadBounds(), screen.getAllDisplays().map((d) => d.workArea));

  const window = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 240,
    title: 'Claude Panel',
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

  const persist = () => {
    if (!window.isDestroyed() && !window.isMinimized()) {
      saveBounds(window.getBounds());
    }
  };
  window.on('resized', persist);
  window.on('moved', persist);

  // A renderer error would otherwise be invisible: the window just stays empty.
  window.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`[renderer] ${message} (${source}:${String(line)})`);
  });
  window.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] gone:', details.reason);
  });

  window.once('ready-to-show', () => {
    window.show();

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
      }, 2500);
    }
  });

  void window.loadFile(path.join(APP_ROOT, 'index.html'));
  return window;
}

app.whenReady().then(() => {
  const window = createWindow();
  host.attach(window);

  ipcMain.on('panel:message', (_event, message: WebviewMessage | ToolbarMessage) => {
    // The top bar is ours, not the extension's: its actions are intercepted before the
    // ported dispatcher sees them, which only knows the webview protocol.
    if (message.type === 'toolbar') {
      handleToolbarAction(message.action);
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
