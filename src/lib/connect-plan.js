/**
 * Deciding what `connect` has to do to Figma before it can talk to it.
 *
 * Lives in its own module so the decision can be unit-tested: the connect
 * command itself probes the CDP port and the process list, neither of which
 * is available in a test run.
 */

/**
 * What `connect` should do, given what is currently running.
 *
 * `connect` used to quit and relaunch Figma unconditionally. That costs the
 * user their window arrangement and any unsaved state every time they run it —
 * including the common case where Figma is already reachable and nothing needs
 * to happen to it at all.
 *
 * Pipe Mode (the default since 2026-09-11 on macOS and Linux) adds one state: a daemon that
 * already holds Figma's debugging pipe. That Figma has no port, so `cdpReachable` is false
 * for it, and it must not be quit — the daemon is the connection.
 *
 * @param {object} state
 * @param {boolean} state.cdpReachable  the CDP port answered
 * @param {boolean} state.figmaRunning  a Figma process exists
 * @param {boolean} [state.pipeHeld]    a daemon reports mode `pipe` with a live pipe
 * @param {boolean} [state.pipe]        the caller wants Pipe Mode (else the port/patch path)
 * @returns {'reuse'|'reuse-pipe'|'needs-quit'|'start-fresh'|'start-pipe'}
 *   `reuse`       — Figma is already debuggable over the port; leave it alone, wire up the daemon.
 *   `reuse-pipe`  — a daemon already holds the pipe; nothing to start.
 *   `needs-quit`  — Figma runs without either. Only the user can quit it safely (unsaved
 *                   work), so ask instead of killing it.
 *   `start-fresh` — no Figma at all; patch if needed and launch it over the port.
 *   `start-pipe`  — no Figma at all; a pipe-mode daemon launches it.
 */
export function resolveConnectAction({ cdpReachable, figmaRunning, pipeHeld = false, pipe = false }) {
  if (pipeHeld) return 'reuse-pipe';
  if (cdpReachable) return 'reuse';
  if (figmaRunning) return 'needs-quit';
  return pipe ? 'start-pipe' : 'start-fresh';
}
