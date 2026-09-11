/**
 * Chromium switches every Figma launch gets, whichever mode starts it.
 *
 * Figma Desktop is an Electron app, and Chromium throttles a window it considers hidden: an
 * occluded window's timers fire once a second, and after five minutes once a MINUTE ("intensive
 * wake-up throttling"). Measured on 2026-09-11 with Figma behind the terminal: `setTimeout(0)`
 * fired 7 times in 44.9 s, `document.visibilityState` said "hidden", and a 400-text render whose
 * generated code awaits once per text took over 90 s instead of 14 s — 12 s per node, while the
 * same render with Figma visible took 145 ms per node. Every `await` in evaluated code, and
 * every async Plugin API call, waits on those timers.
 *
 * These switches are Chromium's own and reach it through Electron's argv; Figma strips only
 * `--remote-debugging-port` (see src/lib/figma-pipe.js). One list, so Pipe, Yolo and Safe Mode
 * launches cannot drift apart.
 */
export const FIGMA_LAUNCH_ARGS = Object.freeze([
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]);
