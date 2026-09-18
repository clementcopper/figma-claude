/**
 * What a command does when the daemon says "not connected".
 *
 * Pure: the caller does the asking and the printing.
 *
 * The fallback used to be `FigmaClient.isConnected()`, which fetches `http://localhost:<port>/json`.
 * Pipe Mode and Safe Mode never open that port, so in those two modes the fallback is a
 * guaranteed false — measured 2026-09-18 while the daemon was healthily driving m2trust:
 * `/health` said `cdp:true`, `isConnected()` said false. A single transient no from the daemon
 * therefore ended the command with `✗ Not connected to Figma` and exit 1, with no second look.
 * In a portless mode the daemon's own answer is the only one that exists, so it gets asked twice
 * (the second time unconditionally fresh, `/health/force`) before anything is printed.
 *
 * @param {{ health: { status?: string, plugin?: boolean, cdp?: boolean, mode?: string } | null,
 *           configMode?: string, attempt?: number }} input
 * @returns {'ok' | 'retry' | 'probe-port' | 'fail'}
 *   ok         — the daemon is driving Figma
 *   retry      — ask the daemon once more, forced
 *   probe-port — this mode has a debug port; fall back to probing it (Yolo, Browser)
 *   fail       — nothing left to try, print the advice
 */
export function connectionVerdict({ health, configMode = '', attempt = 0 } = {}) {
  if (health && health.status === 'ok' && (health.plugin || health.cdp)) return 'ok';
  // The daemon's own word for its mode beats the config, which can name a mode the running
  // daemon is not in (`connect --safe` writes the config before the daemon restarts).
  const mode = (health && health.mode) || configMode || '';
  const portless = mode === 'pipe' || mode === 'safe';
  if (!portless) return 'probe-port';
  return attempt < 1 ? 'retry' : 'fail';
}
