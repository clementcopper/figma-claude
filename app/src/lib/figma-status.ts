/**
 * Turning what the daemon reports into what the panel shows.
 *
 * Pure on purpose: the interesting cases (daemon down, CDP down, Safe Mode, nothing selected)
 * are exactly the ones that are tedious to reproduce live.
 */

export interface Health {
  status?: string;
  mode?: string;
  plugin?: boolean;
  cdp?: boolean;
  file?: string | null;
}

export interface FigmaStatusView {
  /** 'ok' | 'off' — daemon reachable at all. */
  daemon: 'ok' | 'off';
  /** 'ok' | 'off' — a live connection into Figma, whichever mode provides it. */
  figma: 'ok' | 'off';
  /** Yolo / Safe / Browser, as the daemon names it. Empty when unreachable. */
  mode: string;
  /** Open file the daemon is bound to. */
  file: string;
  tooltip: string;
}

/**
 * The daemon reports the browser page title, which Figma suffixes with " – Figma". In a bar
 * that is already inside a Figma tool, that word is noise.
 */
export function cleanFileName(title: string | null | undefined): string {
  if (typeof title !== 'string') return '';
  return title.replace(/\s*[–—-]\s*Figma\s*$/u, '').trim();
}

export function toStatusView(health: Health | null): FigmaStatusView {
  if (!health) {
    return {
      daemon: 'off',
      figma: 'off',
      mode: '',
      file: '',
      tooltip: 'Daemon not running — run `figma-cli connect`'
    };
  }

  // Either transport counts: Yolo talks CDP, Safe Mode talks to the plugin.
  const figma = health.cdp || health.plugin ? 'ok' : 'off';
  const mode = typeof health.mode === 'string' ? health.mode : '';
  const file = cleanFileName(health.file);

  const tooltip =
    figma === 'ok'
      ? `Figma connected${mode ? ` (${mode})` : ''}${file ? ` — ${file}` : ''}`
      : 'Daemon running, but no connection to Figma';

  return { daemon: 'ok', figma, mode, file, tooltip };
}

export interface SelectedNode {
  id: string;
  name: string;
  type: string;
}

/** Short label for the status row: what is selected, without the ids. */
export function describeSelection(nodes: SelectedNode[], page?: string): string {
  if (nodes.length === 0) {
    return page ? `${page} — nothing selected` : 'nothing selected';
  }
  if (nodes.length === 1) {
    return nodes[0].name;
  }
  return `${String(nodes.length)} selected: ${nodes.map((n) => n.name).join(', ')}`;
}

/**
 * What gets written into Claude's prompt. Ids are the part that matters — they are what
 * `figma-cli get`, `set` and `render --parent` take — so they are never abbreviated away.
 */
export function selectionPromptText(nodes: SelectedNode[]): string | null {
  if (nodes.length === 0) {
    return null;
  }
  const parts = nodes.map((n) => `"${n.name}" (${n.type} ${n.id})`);
  return `Figma selection: ${parts.join(', ')}`;
}

export interface LabelInput {
  daemon: 'ok' | 'off';
  figma: 'ok' | 'off';
  file: string;
  page: string;
}

/**
 * The one line the connection button shows: file and page, the way Figma's own breadcrumb reads.
 *
 * Both names come from the Plugin API, so this is the same string in every connection mode. The
 * fallbacks name the state instead of the file — an empty button says nothing about why it is empty.
 */
export function figmaButtonLabel({ daemon, figma, file, page }: LabelInput): string {
  if (daemon !== 'ok') return 'offline';
  if (figma !== 'ok') return 'not connected';
  if (file && page) return `${file}/${page}`;
  return file || page || 'no file';
}

export interface Probe {
  /** A Figma process exists (pgrep). */
  figmaRunning: boolean;
  /** The CDP port answered. */
  cdpOk: boolean;
  cdpPort: number;
  health: Health | null;
}

export interface StatusRow {
  label: string;
  /** 'ok' green, 'warn' yellow, 'off' red — the three states fig-status prints. */
  state: 'ok' | 'warn' | 'off';
  value: string;
}

/**
 * The three rows of the popover's status block — the same readout `bin/fig-status` prints, so
 * the panel and the shell script cannot drift apart in what they call a working connection.
 */
export function statusRows({ figmaRunning, cdpOk, cdpPort, health }: Probe): StatusRow[] {
  const daemonUp = health !== null;
  const connected = Boolean(health && (health.cdp || health.plugin));

  return [
    {
      label: 'Figma',
      state: figmaRunning ? 'ok' : 'warn',
      value: figmaRunning ? 'running' : 'not running'
    },
    {
      // Safe Mode reaches Figma through the plugin, so a dead port is not a fault there.
      label: 'CDP',
      state: cdpOk ? 'ok' : health?.plugin ? 'warn' : 'off',
      value: cdpOk ? `port ${String(cdpPort)}` : health?.plugin ? 'unused (plugin)' : 'not reachable'
    },
    {
      label: 'Daemon',
      state: connected ? 'ok' : daemonUp ? 'warn' : 'off',
      value: !daemonUp ? 'not running' : connected ? health?.mode || 'connected' : 'no connection to Figma'
    }
  ];
}
