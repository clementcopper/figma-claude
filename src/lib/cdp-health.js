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

/**
 * @param {{ ws?: { readyState: number } | null, eval: (expr: string) => Promise<unknown> } | null} client
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<'healthy' | 'no-figma' | 'dead'>}
 *   healthy  — the bound context still has `figma`
 *   no-figma — the socket is open but `figma` is gone from the context (Figma dropped its realm)
 *   dead     — no client, socket not open, eval threw or timed out
 */
export async function probeCdpClient(client, { timeoutMs = 2000 } = {}) {
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
