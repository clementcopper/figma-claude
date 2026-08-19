/**
 * What to write into a tab when its process is gone.
 *
 * One shape of failure deserves more than a number: the process died instantly, with code 1, and
 * never printed a thing. `[Process exited with code 1]` on its own reads like a broken `claude`
 * or a broken PATH, and both send you looking in the wrong place.
 *
 * The one cause seen so far is a stale instance — `npm run install:app` replaced the bundle in
 * /Applications while the app was running, and terminals opened afterwards died this way. The
 * hint therefore names that possibility without claiming it: removing node-pty's `spawn-helper`,
 * the obvious suspect inside such a bundle, was tried and produces a different message
 * ("Error starting terminal: posix_spawnp failed"), so the exact mechanism is not established.
 * Whatever it is, quitting and reopening is the answer, and the line says so.
 */

export interface PtyExit {
  code: number;
  /** Milliseconds between spawning the process and its exit. */
  msSinceSpawn: number;
  /** Did the process ever write to the terminal? */
  sawOutput: boolean;
}

/** How long a process may live and still count as "died on startup". */
const IMMEDIATE_MS = 1000;

export function describePtyExit({ code, msSinceSpawn, sawOutput }: PtyExit): string {
  const line = `\r\n[Process exited with code ${String(code)}]\r\n`;

  if (code === 1 && !sawOutput && msSinceSpawn < IMMEDIATE_MS) {
    return (
      line +
      '\r\nIt printed nothing before exiting. If FigmaClaude was reinstalled while running,\r\n' +
      'quit it and open it again — a replaced bundle breaks the terminals of the old instance.\r\n'
    );
  }

  return line;
}
