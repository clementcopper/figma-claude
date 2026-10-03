/**
 * Is the daemon's CDP client still driving a Figma document?
 *
 * The old probe evaluated `1`, which succeeds in any execution context — so when Figma tore
 * down the realm that holds `figma` (seen 2026-09-16: the tab stayed open, `typeof figma`
 * turned undefined mid-session), /health kept saying Connected while every command failed
 * with "Cannot read properties of undefined (reading 'getNodeByIdAsync')". The probe now asks
 * for `figma` itself, and a client whose context lost it counts as gone: the daemon drops it
 * and re-acquires the context the way it does after a socket close.
 */

export const FIGMA_PROBE = 'typeof figma !== "undefined"';

/** How long a probe may wait for Figma. The CLI's own wait for /health must exceed it (tests/health-timing.test.js). */
export const PROBE_TIMEOUT_MS = 2000;

/**
 * While Figma is running code for this daemon, a probe would only wait behind that code and
 * read "dead" after PROBE_TIMEOUT_MS — measured 2026-10-03: during an 8 s eval every /health
 * took 2 s and said cdp:false, `status` said "Not connected", and the CLI's 1 s curl gave up
 * and sent `eval` down a port path Pipe Mode never opens. The link was fine; it was in use.
 *
 * @param {number} rendererBusy evals in flight for this daemon
 * @returns {'healthy' | null} the verdict to serve without probing, or null to probe
 */
export function probeWhileBusy(rendererBusy) {
  return rendererBusy > 0 ? 'healthy' : null;
}

/**
 * @param {{ ws?: { readyState: number } | null, eval: (expr: string) => Promise<unknown> } | null} client
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<'healthy' | 'no-figma' | 'dead'>}
 *   healthy  — the bound context still has `figma`
 *   no-figma — the socket is open but `figma` is gone from the context (Figma dropped its realm)
 *   dead     — no client, socket not open, eval threw or timed out
 */
export async function probeCdpClient(client, { timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  if (!client || !client.ws || client.ws.readyState !== 1) return 'dead';
  try {
    const value = await Promise.race([
      client.eval(FIGMA_PROBE),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return value === true ? 'healthy' : 'no-figma';
  } catch {
    return 'dead';
  }
}

/**
 * May `/health` answer from its cached verdict, or must it probe again?
 *
 * A positive is worth caching: it costs an eval per request otherwise, and a connection that
 * worked a moment ago almost always still works. A *negative* is not. The probe fails whenever
 * Figma cannot answer within two seconds — which includes a Figma that is merely busy, e.g.
 * executing a 21-second render while the panel's 2.5-second poll comes in. Cached for 30
 * seconds, that one miss made every command say "Not connected to Figma" for half a minute
 * after the render had finished (FEEDBACK.md, 11 Sep 2026).
 *
 * @param {boolean} lastResult  the cached verdict
 * @param {number} ageMs        how old it is
 * @param {{ positiveTtlMs?: number, negativeTtlMs?: number }} [ttl]
 * @returns {boolean} true = serve the cache, false = probe again
 */
export function serveCachedHealth(lastResult, ageMs, { positiveTtlMs = 30000, negativeTtlMs = 2000 } = {}) {
  if (!(ageMs >= 0)) return false;
  return ageMs < (lastResult ? positiveTtlMs : negativeTtlMs);
}
