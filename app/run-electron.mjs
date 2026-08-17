import { spawn } from 'child_process';
import { createRequire } from 'module';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Starts Electron with `ELECTRON_RUN_AS_NODE` removed.
 *
 * Any terminal that was itself started by an Electron app (VS Code, Claude Code, …) can carry
 * that variable, and it turns the Electron binary into a plain Node process: `require('electron')`
 * then fails with "Cannot find module 'electron'" — which reads like a broken install, not like
 * an inherited environment variable.
 */
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const electron = require('electron');
const child = spawn(electron, [ROOT, ...process.argv.slice(2)], { stdio: 'inherit', env });

child.on('close', (code) => {
  process.exit(code ?? 0);
});
