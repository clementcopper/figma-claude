import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { randomBytes } from 'crypto';

// 32 random bytes as hex — what generateDaemonToken has always written.
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

/**
 * The daemon's session token, reused across daemon starts.
 *
 * Every start used to write a fresh token. The daemon reads the file once at startup and the
 * CLI reads it per request, so for them rotation was free — but the Safe Mode plugin keeps its
 * copy in `figma.clientStorage` and only asks for a new one when it has none. After the idle
 * shutdown respawned the daemon, the plugin kept knocking with the old token and every
 * handshake was refused in silence: nothing in Figma said "token changed", the CLI only saw
 * "Plugin not connected". Reusing a valid token makes a restart invisible to the plugin.
 * Deleting the file rotates it.
 *
 * @param {string} file path of the token file
 * @param {{ random?: () => string, now?: () => number }} [deps] test seams
 * @returns {{ token: string, reused: boolean }}
 */
export function ensureDaemonToken(file, deps = {}) {
  const random = deps.random || (() => randomBytes(32).toString('hex'));
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (TOKEN_SHAPE.test(existing)) return { token: existing, reused: true };
  } catch {
    // missing or unreadable: mint one below
  }
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const token = random();
  writeFileSync(file, token, { mode: 0o600 });
  return { token, reused: false };
}
