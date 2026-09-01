/**
 * Telling the difference between "your code returned nothing" and "nothing happened".
 *
 * `eval` prints the value the code evaluates to. A script that ends in `console.log(...)` returns
 * `undefined`, so the command printed nothing at all and exited 0 — reported from the panel, where
 * that is indistinguishable from a dead daemon or an unbound file. The log itself went to Figma's
 * own renderer console, which nobody in a terminal can see.
 *
 * Rather than capture the console (which would change what every command that evaluates code gets
 * back), the silence is named: if the code logged and the result was empty, say where the output
 * went and what to do instead.
 */

/**
 * @param {string} code the user's code
 * @param {unknown} result what it evaluated to
 * @returns {string|null} a line to print after an empty result, or null when nothing needs saying
 */
export function evalSilenceHint(code, result) {
  if (result !== undefined && result !== null) return null;

  const src = String(code || '');
  // `console.log` is the common one, but the whole family goes to the same invisible place.
  if (!/\bconsole\.(log|info|warn|error|debug|table|dir)\s*\(/.test(src)) {
    return 'no value returned (the code evaluated to undefined)';
  }

  return 'no value returned — console output goes to Figma\'s own console, not here. Return the value instead: `return JSON.stringify(x)`';
}

/**
 * The whole "print the result, or explain the silence" decision, in one place.
 *
 * `eval` and `run` each carried their own copy of this `if`, and they drifted: `run` never got
 * the silence hint at all, so a `console.log` script stayed indistinguishable from a dead daemon
 * there long after `eval` was fixed — reported from the panel a second time. `run` also treated
 * `null` as a value and printed the bare word `null`.
 *
 * @param {string} code the user's code
 * @param {unknown} result what it evaluated to
 * @returns {{ text: string, dim: boolean }} `dim` marks the hint, which is not output but a note
 */
export function formatEvalOutput(code, result) {
  if (result !== undefined && result !== null) {
    return { text: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result), dim: false };
  }
  return { text: '· ' + evalSilenceHint(code, result), dim: true };
}
