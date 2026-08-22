/**
 * Building the `eval "<code>"` argument the legacy `figmaUse` helper takes.
 *
 * Every call site used to write this by hand as
 *
 *     figmaUse(`eval "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`)
 *
 * and that second `replace` is a trap: it puts the code on one line, where a `//` comment
 * swallows everything after it. What follows is not a syntax error anyone sees — the daemon
 * reports a code error, `figmaEvalSync` reads that as a connection problem, falls back to its own
 * CDP connection and dies in its 60 s `execSync` timeout. All the terminal shows is
 * `Error: spawnSync /bin/sh ETIMEDOUT`, which reads like a dead daemon.
 *
 * The flattening was never needed. `figmaUse` parses its argument with
 * `/^eval\s+"(.+)"$/s` — the `s` flag lets `.` match newlines, so multi-line code survives.
 *
 * Only the quotes are escaped, and only doubles: `figmaUse` unescapes `\"` back to `"`.
 */
export function evalArg(code) {
  return `eval "${String(code).replace(/"/g, '\\"')}"`;
}
