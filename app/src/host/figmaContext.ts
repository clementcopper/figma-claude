import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { toStatusView, type FigmaStatusView, type Health, type SelectedNode } from '../lib/figma-status';

const DAEMON_PORT = Number(process.env.FIGMA_DAEMON_PORT ?? 3456);
const TOKEN_FILE = path.join(os.homedir(), '.figma-ds-cli', '.daemon-token');

/**
 * What the panel knows about Figma. All of it comes from the CLI's daemon — the panel opens no
 * connection of its own, so whatever the CLI can see, the panel shows, and nothing more.
 */
export interface FigmaSnapshot {
  status: FigmaStatusView;
  /** The daemon's raw answer, for the status block that needs more than two dots. */
  health: Health | null;
  /** Document name from the Plugin API — present in every mode, unlike the daemon's page title. */
  file: string;
  page: string;
  selection: SelectedNode[];
}

function readToken(): string | null {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

async function health(): Promise<Health | null> {
  const token = readToken();
  if (!token) return null;
  try {
    const response = await fetch(`http://127.0.0.1:${String(DAEMON_PORT)}/health`, {
      headers: { 'X-Daemon-Token': token },
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) return null;
    return (await response.json()) as Health;
  } catch {
    // Daemon down is a normal state, not an error worth logging every two seconds.
    return null;
  }
}

/**
 * Asks the daemon to rebuild its CDP connection. Works whenever Figma is running with the
 * debug port open — the usual case after Figma was restarted — and fails when there is nothing
 * to connect to, which is when the CLI's own `connect` (patching, starting Figma, permissions)
 * is needed instead.
 */
export async function reconnect(): Promise<boolean> {
  const token = readToken();
  if (!token) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${String(DAEMON_PORT)}/reconnect`, {
      headers: { 'X-Daemon-Token': token },
      signal: AbortSignal.timeout(8000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Runs code inside Figma through the daemon — the same `/exec` route the CLI uses. */
export async function evaluate<T>(code: string, timeoutMs = 4000): Promise<T | null> {
  const token = readToken();
  if (!token) return null;
  try {
    const response = await fetch(`http://127.0.0.1:${String(DAEMON_PORT)}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Daemon-Token': token },
      body: JSON.stringify({ action: 'eval', code }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { result?: T };
    return body.result ?? null;
  } catch {
    return null;
  }
}

const SELECTION_CODE = `return JSON.stringify({
  file: figma.root.name,
  page: figma.currentPage.name,
  selection: figma.currentPage.selection.map(n => ({ id: n.id, name: n.name, type: n.type })).slice(0, 12)
})`;

/**
 * Polls the daemon and reports what changed.
 *
 * Only while the window has focus: the selection query is a real round trip into Figma, and a
 * panel sitting in the background has nobody to show it to.
 */
export class FigmaContextWatcher {
  private timer: NodeJS.Timeout | undefined;
  private firstTick: Promise<void> | undefined;
  private active = false;
  private lastSerialized = '';
  private current: FigmaSnapshot = {
    status: toStatusView(null),
    health: null,
    file: '',
    page: '',
    selection: []
  };

  constructor(
    private readonly onChange: (snapshot: FigmaSnapshot) => void,
    private readonly intervalMs = 2500
  ) {}

  get snapshot(): FigmaSnapshot {
    return this.current;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.firstTick = this.tick();
  }

  /**
   * Resolves once the first poll has landed, or after `maxWaitMs` — whichever is first.
   *
   * The first tab spawns right after `start()`, and its session name wants the Figma file.
   * Against a live daemon `/health` answers in one or two milliseconds, so the wait is not
   * felt; the cap is for the case where the daemon is gone, and then the working directory
   * is the right name anyway.
   */
  async settled(maxWaitMs: number): Promise<void> {
    if (!this.firstTick) return;
    await Promise.race([
      this.firstTick,
      new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs))
    ]);
  }

  stop(): void {
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** One poll now, regardless of the timer — used when the window regains focus. */
  refresh(): void {
    void this.tick(false);
  }

  private async tick(schedule = true): Promise<void> {
    const reported = await health();
    const status = toStatusView(reported);

    // The daemon's own title is the fallback: it survives an `eval` that times out mid-render.
    let file = status.file;
    let page = '';
    let selection: SelectedNode[] = [];
    if (status.figma === 'ok') {
      const raw = await evaluate<string>(SELECTION_CODE);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { file?: string; page?: string; selection?: SelectedNode[] };
          file = parsed.file || file;
          page = parsed.page ?? '';
          selection = parsed.selection ?? [];
        } catch {
          // A malformed answer is treated as "nothing selected" rather than an error state.
        }
      }
    }

    this.current = { status, health: reported, file, page, selection };

    // Only speak when something actually changed: the row would otherwise rebuild every
    // few seconds, and rebuilding it refits xterm.
    const serialized = JSON.stringify(this.current);
    if (serialized !== this.lastSerialized) {
      this.lastSerialized = serialized;
      this.onChange(this.current);
    }

    if (schedule && this.active) {
      this.timer = setTimeout(() => void this.tick(), this.intervalMs);
    }
  }
}
