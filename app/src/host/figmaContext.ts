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

/** Runs code inside Figma through the daemon — the same `/exec` route the CLI uses. */
async function evaluate<T>(code: string, timeoutMs = 4000): Promise<T | null> {
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
  private active = false;
  private lastSerialized = '';
  private current: FigmaSnapshot = {
    status: toStatusView(null),
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
    void this.tick();
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
    const status = toStatusView(await health());

    let page = '';
    let selection: SelectedNode[] = [];
    if (status.figma === 'ok') {
      const raw = await evaluate<string>(SELECTION_CODE);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { page?: string; selection?: SelectedNode[] };
          page = parsed.page ?? '';
          selection = parsed.selection ?? [];
        } catch {
          // A malformed answer is treated as "nothing selected" rather than an error state.
        }
      }
    }

    this.current = { status, page, selection };

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
