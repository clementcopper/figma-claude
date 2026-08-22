/**
 * Handing a newer rate limit to tabs that are not rendering anything themselves.
 *
 * The reset countdown ticks without Claude because `sessionResetsAt` is an absolute point (see
 * `limit-window.ts`). The percentage cannot work that way — it exists only in Claude's payload,
 * and that arrives only when Claude renders. But the limits belong to the account, so whichever
 * tab last saw them has already written them to `status/last/limits.json`, shared across windows
 * through `os.tmpdir()`. This decides what to do with a file that turns out to be newer.
 *
 * Pure, because the interesting parts are the comparisons: an unchanged file must not produce a
 * second callback, a tab that rendered later than the file already knows better, and a window
 * that has since reset must not hand out a stale percentage.
 *
 * Ported from claude-terminal-panel@783cbdc, where the same rules live inside the watcher.
 */

import { applyResetWindow } from './limit-window';

/** The five account-wide fields, plus when the tab that wrote them last rendered. */
export interface BroadcastLimits {
  sessionPercent?: number;
  sessionResetsAt?: number;
  sessionResetsInMin?: number;
  weekPercent?: number;
  weekResetsAt?: string;
  updatedAt?: number;
}

/** What this decision needs from a snapshot — the real one carries far more. */
export interface LimitedSnapshot {
  updatedAt: number;
  sessionPercent?: number;
  sessionResetsAt?: number;
  sessionResetsInMin?: number;
  weekPercent?: number;
  weekResetsAt?: string;
}

export interface LimitsBroadcast<T> {
  /** `updatedAt` of the file this plan was built from — the caller remembers it. */
  limitsAt: number;
  /** Tab id and its replacement snapshot. Empty when every tab is already newer. */
  updates: [string, T][];
}

/**
 * @param limits          what `last/limits.json` currently holds, or undefined if unreadable
 * @param lastBroadcastAt `limitsAt` of the previous plan, so one write is not sent twice
 * @param snapshots       the live snapshot per tab id
 * @param now             milliseconds since the epoch, passed in so the reset boundary is testable
 * @returns the plan, or `null` when there is nothing new to say
 */
export function planLimitsBroadcast<T extends LimitedSnapshot>(
  limits: BroadcastLimits | undefined,
  lastBroadcastAt: number | undefined,
  snapshots: Iterable<[string, T]>,
  now: number
): LimitsBroadcast<T> | null {
  const limitsAt = limits?.updatedAt;
  if (!limits || limitsAt === undefined || limitsAt === lastBroadcastAt) {
    return null;
  }

  const updates: [string, T][] = [];
  for (const [terminalId, snapshot] of snapshots) {
    // A tab that rendered more recently than the file already knows better
    if (limitsAt <= snapshot.updatedAt) {
      continue;
    }

    // The five limit fields are replaced outright — the opposite rule to the one that fills a
    // fresh tab, where only gaps are filled so a live value wins. Here the file *is* the newer
    // value. `updatedAt` is deliberately left alone: the tab's model and context really are old,
    // and the stale dimming exempts the limits row (`styles.css`: `:not(.secondary)`).
    const merged = applyResetWindow(
      {
        ...snapshot,
        sessionPercent: limits.sessionPercent,
        sessionResetsAt: limits.sessionResetsAt,
        sessionResetsInMin: limits.sessionResetsInMin,
        weekPercent: limits.weekPercent,
        weekResetsAt: limits.weekResetsAt
      },
      now
    );

    updates.push([terminalId, merged]);
  }

  return { limitsAt, updates };
}
