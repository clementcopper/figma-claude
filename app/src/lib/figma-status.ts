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
