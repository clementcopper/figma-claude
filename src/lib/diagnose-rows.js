/**
 * What `diagnose` says about the debug port and the Figma version, by transport.
 *
 * The port row was written for Yolo Mode, where a closed 9222 is the fault. Safe Mode got its
 * exception; Pipe Mode did not, so a healthy pipe-mode setup printed "✗ Remote debugging not
 * available (port 9222 closed) → Run: connect" two lines above "✓ Connected" — and told a panel
 * session to run the one command its rules forbid (reported from the panel). The 126+ warning
 * is the same story: Figma 126 blocks the PORT by default, which only matters when the port is
 * the way in.
 *
 * Pure, so the wording is unit-tested per mode.
 */

/** @typedef {'pipe'|'safe'|'yolo'|'browser'|'auto'|null|undefined} Mode */

/**
 * @param {Mode} mode the daemon's mode from /health, else config.mode
 * @param {boolean} portOpen whether /json/version answered on the port
 * @param {number} port
 * @returns {{ ok: boolean, level: 'ok'|'info'|'fail', text: string, hint: string|null }}
 */
export function debugPortRow(mode, portOpen, port) {
  if (portOpen) return { ok: true, level: 'ok', text: `Remote debugging enabled (port ${port})`, hint: null };
  if (mode === 'pipe') {
    return { ok: true, level: 'info', text: `Remote debugging port ${port} closed (Pipe Mode: CDP runs over Figma's pipe, no port needed)`, hint: null };
  }
  if (mode === 'safe') {
    return { ok: true, level: 'info', text: `Remote debugging port ${port} closed (Safe Mode: the plugin is connected, no port needed)`, hint: null };
  }
  return { ok: false, level: 'fail', text: `Remote debugging not available (port ${port} closed)`, hint: 'Run: node src/index.js connect' };
}

/**
 * @param {string} version e.g. "126.7.10"
 * @param {Mode} mode
 * @returns {{ level: 'ok'|'warn', text: string }}
 */
export function figmaVersionRow(version, mode) {
  const major = parseInt(String(version).split('.')[0], 10);
  const portIsTheWayIn = mode !== 'pipe' && mode !== 'safe';
  if (major >= 126 && portIsTheWayIn) {
    return { level: 'warn', text: `Figma ${version} (126+ blocks remote debugging by default)` };
  }
  return { level: 'ok', text: `Figma ${version}` };
}
