/**
 * How much to scale the whole window.
 *
 * VS Code scales its webviews with `window.zoomLevel`, so the extension's 10 px status row shows
 * up at 12 px for anyone running level 1 — and the panel never had to know about it. A window has
 * no such setting above it, which is why the copied CSS looks smaller here than in the editor.
 *
 * The key is the factor rather than VS Code's level: `1.2`, not `1`. A level is only readable if
 * you remember it is 1.2 to the power of n, and this value sits in a file people edit by hand.
 *
 * Pure and clamped for the same reason: the value comes from that hand-edited file, and a window
 * at factor 0 or 40 cannot be operated back to a sane state.
 */

/** Below this the traffic lights and the status rows stop being legible. */
const MIN = 0.5;
/** Above this a 320 px-wide window has room for almost nothing. */
const MAX = 3;
/** What the upstream panel effectively runs at when VS Code is not zoomed. */
const DEFAULT = 1;

export function resolveZoomFactor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT;
  }
  return Math.min(MAX, Math.max(MIN, value));
}
