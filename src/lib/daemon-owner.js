/**
 * Is the process holding the daemon port ours?
 *
 * `daemon stop` and `daemon restart` used to run `lsof -ti:3456 | xargs kill -9`, so a dev
 * server that happened to sit on 3456 died without a word. Only a process whose command line
 * runs our daemon.js may be killed by port; anything else is reported and left alone.
 */
export function isOurDaemon(commandLine) {
  return typeof commandLine === 'string' && /(^|[\\/\s])daemon\.js(\s|$)/.test(commandLine);
}
