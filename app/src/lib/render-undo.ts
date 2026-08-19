/**
 * Undoing the last render without the CLI.
 *
 * `figma-cli render` records what it created in ~/.figma-ds-cli/last-render.json
 * (src/commands/render.js), and `figma-cli undo` removes exactly those nodes. The panel does the
 * same over the daemon's /exec route, so the button works on a machine where the CLI is only a
 * checkout — and it can never touch anything else on the canvas: the ids come from that file
 * alone, nothing is searched for or guessed.
 */

export interface CreatedNode {
  id: string;
  name: string;
}

/** Reads the state file's content. Anything malformed means "nothing to undo", never a crash. */
export function parseLastRender(raw: string | null | undefined): CreatedNode[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const nodes = (parsed as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .filter((n): n is { id: string; name?: string } => Boolean(n) && typeof (n as { id?: unknown }).id === 'string')
    .map((n) => ({ id: n.id, name: typeof n.name === 'string' ? n.name : '' }));
}

/** The same removal loop `figma-cli undo` runs — one round trip, ids only. */
export function buildUndoEval(ids: string[]): string {
  return `(async () => {
  let removed = 0;
  const names = [];
  for (const id of ${JSON.stringify(ids)}) {
    const node = await figma.getNodeByIdAsync(id);
    if (node && !node.removed) { names.push(node.name); node.remove(); removed++; }
  }
  return { removed, names };
})()`;
}

export interface UndoResult {
  removed?: number;
  names?: string[];
}

/** What the button says — it names the count, so a stale state file is visible before the click. */
export function undoLabel(nodes: CreatedNode[]): string {
  if (nodes.length === 0) return 'Nothing to undo';
  if (nodes.length === 1) return `Undo last render (${nodes[0].name || '1 node'})`;
  return `Undo last render (${String(nodes.length)} nodes)`;
}

/** What the popover reports afterwards. */
export function undoMessage(result: UndoResult | null): string {
  const removed = result?.removed ?? 0;
  if (removed === 0) return 'Nothing to undo — the nodes are already gone';
  const names = (result?.names ?? []).filter(Boolean);
  const what = names.length > 0 ? names.join(', ') : `${String(removed)} nodes`;
  return `Removed ${what}`;
}
