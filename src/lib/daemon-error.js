/**
 * What the CLI makes of a non-ok answer from the daemon's /exec.
 *
 * Two things used to be decided on the error text. The auth hint ("Token file: …",
 * "Try: daemon restart") was keyed on the word `token`, so `SyntaxError: Invalid or unexpected
 * token` — a broken run script — came back with a daemon-token hint and nothing about the
 * script (FEEDBACK.md, 2026-10-02). The daemon answers a failed auth with HTTP 403
 * (src/daemon.js, validateRequest) and every code error with 500, so the status decides.
 *
 * The second: the error text was cut to its first line for every command. The daemon forwards
 * V8's stack (`at get_visible (<anonymous>:4:17)`), and `eval`/`run` want it. The message stays
 * one line — twenty-odd commands print `e.message` as is — and the frames travel beside it as
 * `figmaStack`, for the two commands that relocate them onto the submitted file
 * (src/lib/eval-error.js).
 *
 * Pure: the status and the body are passed in.
 *
 * @param {{ status: number, error: string, tokenFile: string }} input
 * @returns {{ message: string, figmaStack: string[] }}
 */
export function classifyDaemonError({ status, error, tokenFile }) {
  const text = String(error == null ? '' : error);
  if (status === 403) {
    return {
      message: `${text}\nToken file: ${tokenFile}\nTry: node src/index.js daemon restart`,
      figmaStack: []
    };
  }
  // Safe Mode: plugin tab was closed → guide the user back to it instead of dumping the raw error.
  if (/Plugin not connected/i.test(text)) {
    return {
      message: 'Plugin not connected.\n' +
        'In Figma: Plugins → Development → FigCli (keep that tab open).\n' +
        'Or switch to Yolo Mode: node src/index.js connect',
      figmaStack: []
    };
  }
  const [first, ...rest] = text.split('\n');
  return { message: first, figmaStack: rest };
}
