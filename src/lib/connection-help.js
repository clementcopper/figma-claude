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
 * @param {{ panel?: boolean }} [opts]
 * @returns {string[]} the lines to print, in order, no colour
 */
export function connectAdvice(opts = {}) {
  if (opts.panel) {
    return [
      'Connect from the panel: the Figma menu in the toolbar → Connect.',
      'Do not run `connect` yourself here — it can quit a running Figma.'
    ];
  }
  return [
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

/** Whether this process runs inside FigmaClaude.app. */
export function inPanel(env = process.env) {
  return env.FIGMACLAUDE === '1';
}
