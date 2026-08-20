/**
 * Installs the built app into /Applications — after making sure it is not running.
 *
 * The one-liner this replaced ran `rm -rf /Applications/FigmaClaude.app` unconditionally. The
 * running instance survives that in memory, but its terminals do not: after an install like
 * that, every new tab died instantly with "[Process exited with code 1]" and no output. Which
 * file it trips over is not established — removing node-pty's `spawn-helper`, the obvious
 * suspect, gives a different message — but a bundle must not be pulled out from under a running
 * app either way.
 */

import { execFileSync, spawnSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';

const TARGET = '/Applications/FigmaClaude.app';
const RELEASE = new URL('../release/', import.meta.url).pathname;
const QUIT_TIMEOUT_MS = 10_000;

// electron-builder names the output directory after the arch it packed for: `mac` on x64,
// `mac-arm64` on Apple Silicon. Hardcoding `mac` made this script report "nothing built" on an
// arm64 machine seconds after the build succeeded.
function findBundle() {
  if (!existsSync(RELEASE)) return null;
  for (const entry of readdirSync(RELEASE)) {
    if (!entry.startsWith('mac')) continue;
    const candidate = `${RELEASE}${entry}/FigmaClaude.app`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const SOURCE = findBundle();

function isRunning() {
  // pgrep exits 1 when nothing matches, which is a normal answer here, not a failure.
  return spawnSync('/usr/bin/pgrep', ['-x', 'FigmaClaude']).status === 0;
}

function sleep(ms) {
  // Deliberately synchronous: this script is a sequence, not a program.
  execFileSync('/bin/sleep', [String(ms / 1000)]);
}

if (!SOURCE) {
  console.error(`✗ No FigmaClaude.app under ${RELEASE}mac*/ — run \`npm run dist\` first.`);
  process.exit(1);
}

if (isRunning()) {
  console.log('• FigmaClaude is running — asking it to quit…');
  spawnSync('/usr/bin/osascript', ['-e', 'quit app "FigmaClaude"']);

  const deadline = Date.now() + QUIT_TIMEOUT_MS;
  while (isRunning() && Date.now() < deadline) {
    sleep(500);
  }

  if (isRunning()) {
    // Force-quitting could cost unsaved work in a terminal; the user decides.
    console.error(
      '✗ FigmaClaude is still running (an open dialog, perhaps). Quit it and run this again —\n' +
        '  replacing the bundle underneath it breaks every terminal in the running instance.'
    );
    process.exit(1);
  }
  console.log('• Quit.');
}

execFileSync('/bin/rm', ['-rf', TARGET]);
execFileSync('/usr/bin/ditto', [SOURCE, TARGET]);

console.log(`✓ Installed to ${TARGET}`);
console.log('  Open it from the Dock or Finder — not from a terminal, which passes its own');
console.log('  environment (ELECTRON_RUN_AS_NODE) into the app.');
