import chalk from 'chalk';

/**
 * The failure line of a read command, in the shape `docs scripting-the-cli` promises: one-line
 * `{ ok: false, error }` under --json, a red ✗ line otherwise. The caller sets
 * `process.exitCode = 1` on the same line — that pairing is what tests/exit-codes.test.js checks.
 */
export function errorOutput(message, options) {
  return options && options.json ? JSON.stringify({ ok: false, error: message }) : chalk.red('✗ ' + message);
}
