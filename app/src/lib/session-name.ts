import * as path from 'path';
import { cleanFileName } from './figma-status';

/**
 * The display name a panel tab starts Claude Code with (`claude -n <name>`).
 *
 * Several Claudes run at once on this machine — one per terminal, one per panel tab — and the
 * `/resume` picker shows them side by side. A name that says both "this one is the panel" and
 * "this one was working on X" is the only way to tell them apart after the fact.
 *
 * The Figma file wins over the working directory: two tabs on the same project are the normal
 * case, two tabs on the same Figma file are not.
 */

/** Prefix every panel session carries, and the whole name when nothing else is known. */
export const SESSION_NAME_PREFIX = 'figma-claude';

/** Long names are truncated in the prompt box anyway; this keeps the suffix readable there. */
const MAX_SUFFIX = 40;

/** C0 and C1 control characters — a stray one turns the terminal title into garbage. */
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/gu;

/**
 * Zero-width and invisible characters. They survive a copy out of Figma and make a name that
 * looks fine but that Claude Code rejects: "That name is empty once invisible characters are
 * stripped".
 */
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/gu;

function sanitize(raw: string): string {
  const cleaned = raw.replace(CONTROL, '').replace(INVISIBLE, '').replace(/\s+/gu, ' ').trim();
  return cleaned.length > MAX_SUFFIX ? cleaned.slice(0, MAX_SUFFIX).trim() : cleaned;
}

export interface SessionNameInput {
  /** Figma file the daemon is bound to, as the watcher reports it (may carry " – Figma"). */
  file?: string | null;
  /** Directory the tab starts in — the fallback while Figma is not connected yet. */
  cwd?: string | null;
}

export function panelSessionName({ file, cwd }: SessionNameInput = {}): string {
  const fromFigma = sanitize(cleanFileName(file));
  if (fromFigma) {
    return `${SESSION_NAME_PREFIX}:${fromFigma}`;
  }

  // `basename('/')` is '/' and `basename('')` is '' — neither says anything about the session.
  const fromCwd = typeof cwd === 'string' ? sanitize(path.basename(cwd.trim())) : '';
  if (fromCwd && fromCwd !== '/' && fromCwd !== '.') {
    return `${SESSION_NAME_PREFIX}:${fromCwd}`;
  }

  return SESSION_NAME_PREFIX;
}
