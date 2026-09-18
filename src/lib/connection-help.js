/**
 * What to tell someone whose command could not reach Figma.
 *
 * Two problems, both reported from the panel:
 *
 * 1. The advice named `figma-ds-cli connect`. That binary alias still exists, but it is not the
 *    name anyone uses, and inside FigmaClaude.app it is worse than useless: a panel session is
 *    told not to connect on its own, so pointing it at a CLI command leaves it to work out for
 *    itself that a human has to press something. The panel exports `FIGMACLAUDE=1`
 *    (`swift-host/Sources/FigmaClaudeCore/PanelConfig.swift`), so the CLI can simply know.
 *
 * 2. A dead or wedged connection surfaced as the raw `spawnSync /bin/sh ETIMEDOUT` from the 60 s
 *    `execSync` in `figmaEvalSync`. That names a shell, not a state, and no way back at all.
 *
 * The wording stays at what is observable. `fetch failed` out of `daemonExec` cannot tell a
 * stopped daemon from a running one whose CDP link died (seen while fixing this: the daemon
 * answered `/health` with `cdp:false` while a fresh `FigmaClient` connected to the same Figma in
 * the same second). So it says the request did not get through, and points at the commands that
 * distinguish the two — it does not claim Figma is gone.
 *
 * Pure: the environment is read at the call site and passed in.
 */

/**
 * @param {{ panel?: boolean, reason?: string | null }} [opts]
 *   `reason` is the daemon's own account of why nothing is attached (`/health.pipeError`,
 *   e.g. "No loaded design file among 2 open tabs …"). Printed first: a reader who sees the
 *   reason knows whether to wait, click a tab, or reconnect — the bare hint sent panel sessions
 *   to a Connect button that was rightly disabled.
 * @returns {string[]} the lines to print, in order, no colour
 */
export function connectAdvice(opts = {}) {
  const reason = typeof opts.reason === 'string' && opts.reason.trim() ? ['The daemon says: ' + opts.reason.trim()] : [];
  if (opts.panel) {
    return [
      ...reason,
      'Connect from the panel: the Figma menu in the toolbar → Connect' + (reason.length ? ' or Reconnect' : '') + '.',
      'Do not run `connect` yourself here — it can quit a running Figma.'
    ];
  }
  return [
    ...reason,
    'Check the link, then reconnect if needed:',
    '  figma-cli status             what the daemon thinks it is connected to',
    '  figma-cli daemon restart     a daemon that lost Figma reports cdp:false',
    '  figma-cli connect            (Yolo Mode)   /  connect --safe (Safe Mode)'
  ];
}

// The shapes a lost connection actually arrives in. `spawnSync /bin/sh ETIMEDOUT` is the 60 s
// `execSync` ceiling; the rest come from curl and from the direct CDP client.
const TIMEOUT = /\bETIMEDOUT\b|\bspawnSync\b.*\btimed? ?out\b/i;
const REFUSED = /\bECONNREFUSED\b|\bfetch failed\b|\bsocket hang up\b|\bECONNRESET\b/i;

/**
 * Turn an error message into something that names a state and a way back — or leave it alone.
 *
 * A message that is not about the connection passes through untouched: dressing a real code
 * error up as "Figma is not reachable" would send the reader to the wrong place entirely.
 *
 * @param {string} message the caught error's `.message`
 * @param {{ panel?: boolean }} [opts]
 * @returns {{ lines: string[], connection: boolean }}
 */
export function explainEvalError(message, opts = {}) {
  const msg = String(message == null ? '' : message);

  if (TIMEOUT.test(msg)) {
    return {
      connection: true,
      lines: [
        'Figma did not answer within 60s — the link is wedged, not your code.',
        ...connectAdvice(opts)
      ]
    };
  }
  if (REFUSED.test(msg)) {
    return {
      connection: true,
      lines: ['The request never reached Figma.', ...connectAdvice(opts)]
    };
  }
  return { connection: false, lines: [msg] };
}

/**
 * What an `Execution timeout` should say. The daemon's answer did not arrive within the budget;
 * whether that is the code's fault or the daemon's is one /health call away, and the two need
 * different advice. "Try: daemon restart" after a 2 s budget on a healthy daemon (reported from
 * the panel) sent the reader to restart a daemon that had done nothing wrong.
 *
 * @param {number} timeoutMs the budget that ran out
 * @param {boolean} daemonHealthy whether /health answered after the timeout
 */
export function timeoutMessage(timeoutMs, daemonHealthy) {
  const s = timeoutMs / 1000;
  if (daemonHealthy) {
    return `Execution timeout (${s}s): the code ran longer than the budget allows — raise it with --timeout <seconds> (eval, run)`;
  }
  return `Execution timeout (${s}s): the daemon did not answer. Try: node src/index.js daemon restart`;
}

/** Whether this process runs inside FigmaClaude.app. */
export function inPanel(env = process.env) {
  return env.FIGMACLAUDE === '1';
}
