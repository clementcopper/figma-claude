/**
 * The daemon hot-reloads figma-client.js by copying it to `src/.figma-client-<mtime>.<pid>.mjs`
 * and importing the copy. A daemon that exits through `shutdown()` unlinks its own copy; one
 * that dies otherwise (SIGKILL, a crash, a Figma quit that takes the pipe holder with it)
 * leaves it there — nine of them, 1.4 MB, after one day of pipe-mode work.
 *
 * A copy is safe to delete exactly when the pid in its name is no longer running: that is
 * the only process that can import it. Pure so it can be tested without a daemon.
 */

const COPY = /^\.figma-client-[\d.]+\.(\d+)\.mjs$/;

/** The pid a copy's name carries, or null when the name is not a copy. */
export function copyOwnerPid(name) {
  const m = COPY.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * Which of `names` (entries of `src/`) are hot-reload copies whose owner is gone.
 * `isAlive(pid)` says whether a process exists; the caller supplies it.
 */
export function staleClientCopies(names, isAlive) {
  return names.filter((name) => {
    const pid = copyOwnerPid(name);
    return pid !== null && !isAlive(pid);
  });
}

/** `process.kill(pid, 0)` sends no signal; EPERM means the process exists under another user. */
export function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM';
  }
}
