/**
 * Keeping the five-hour limit row honest between Claude's renders.
 *
 * A snapshot only arrives when Claude renders, so a remembered "resets in 84 min" is a lie an
 * hour later. `sessionResetsAt` is an absolute point, so the remaining minutes can be recomputed
 * without Claude — which matters most exactly when the limit is spent and nothing renders at all.
 *
 * What is dropped once the point passes, and what is not:
 *
 * - `sessionPercent` and `sessionResetsInMin` go. The window reset; the old percentage says
 *   nothing about the new one, and a countdown to a past point is noise.
 * - **`sessionResetsAt` stays.** The UI shows "Limit reset" from a reset point that lies in the
 *   past — deleting the field takes that state away and the row loses its left half at the very
 *   moment the waiting is over. This host used to delete it, which would have quietly undone
 *   the fix the panel just grew (claude-terminal-panel@6dfc2eb).
 */

export interface LimitFields {
  sessionPercent?: number;
  sessionResetsAt?: number;
  sessionResetsInMin?: number;
}

/**
 * @param snapshot fields as merged from the tab's snapshot and the remembered limits
 * @param now milliseconds since the epoch — passed in so the boundary can be tested
 */
export function applyResetWindow<T extends LimitFields>(snapshot: T, now: number): T {
  const out = { ...snapshot };

  if (out.sessionResetsAt === undefined) {
    delete out.sessionResetsInMin;
    return out;
  }

  const minutes = Math.round((out.sessionResetsAt * 1000 - now) / 60000);
  if (minutes <= 0) {
    delete out.sessionPercent;
    delete out.sessionResetsInMin;
    return out;
  }

  out.sessionResetsInMin = minutes;
  return out;
}
