import { test } from 'node:test';
import assert from 'node:assert';
import { figmaRunningCommand } from '../src/platform.js';

// `pgrep -f` matches the whole command line, so "Figma" hit processes that are not Figma
// Desktop: `FigmaAgent.app/.../figma_agent` (Figma's own updater, running with Figma closed)
// and `FigmaClaude.app` plus its three helpers. `connect` then reported "Figma is running,
// but the debug port is not open" forever — quitting Figma could not clear a match that was
// never Figma. `killFigmaApp`, `bin/fig-start`, `bin/fig-status` and the panel all use `-x`.

test('the darwin probe matches the process name exactly, not the command line', () => {
  const cmd = figmaRunningCommand('darwin');
  assert.match(cmd, /pgrep -x Figma\b/);
  assert.doesNotMatch(cmd, /pgrep -f/);
});

test('the darwin probe does not match FigmaAgent or FigmaClaude', () => {
  const cmd = figmaRunningCommand('darwin');
  // -x compares against the process name; these are `figma_agent` and `FigmaClaude`.
  assert.ok(cmd.includes('-x Figma '), cmd);
  assert.ok(!cmd.includes('FigmaAgent') && !cmd.includes('FigmaClaude'));
});

test('linux keeps the lowercase binary name killFigmaApp uses', () => {
  assert.match(figmaRunningCommand('linux'), /pgrep -x figma\b/);
});

test('windows keeps the tasklist filter', () => {
  assert.match(figmaRunningCommand('win32'), /tasklist \/FI "IMAGENAME eq Figma\.exe"/);
});

test('the unix probe stays silent when nothing matches', () => {
  // pgrep exits 1 on "no match", which execSync would throw on.
  assert.match(figmaRunningCommand('darwin'), /\|\| true$/);
});
