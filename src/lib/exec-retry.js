/**
 * Whether the daemon may run a failed /exec request again.
 *
 * Retrying is only ever right when the code did not reach Figma. Two cases settle that
 * before any health probe is asked:
 *   - a mutating render: `executeEval` may have created the frame before the answer failed,
 *     and a second run makes a duplicate (the rule since the auto-layout release);
 *   - an error Figma itself raised (`exceptionDetails`, flagged `fromFigma` by
 *     `FigmaClient.eval`): the code ran — partly, up to the throw — and a second run repeats
 *     every mutation before that line. The health probe used to be the only guard here, and
 *     a probe that times out while Figma is busy would have re-run a script that had just
 *     detached an instance.
 * Everything else ("Not connected", a closed session, a timeout) is a transport fault, and
 * the caller may reconnect and try again.
 *
 * @returns {'mutating' | 'from-figma' | 'exhausted' | 'consider'}
 */
export function retryVerdict({ action, attempt, maxRetries, error }) {
  if (action === 'render' || action === 'render-batch') return 'mutating';
  if (error && error.fromFigma) return 'from-figma';
  if (attempt >= maxRetries) return 'exhausted';
  return 'consider';
}

/** The log line for a failed try: no "Attempt 1" for a request that is never tried twice. */
export function failureLine(attempt, error) {
  const message = error && error.message ? error.message : String(error);
  return attempt === 0 ? `[daemon] Failed: ${message}` : `[daemon] Retry ${attempt} failed: ${message}`;
}
