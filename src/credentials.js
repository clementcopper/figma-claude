/**
 * Cross-platform secure credential storage.
 * macOS: Keychain via `security` CLI
 * Windows: Credential Manager via `cmdkey`
 * Linux: ~/.config/figma-cli/credentials (chmod 600)
 */

import { execSync, execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SERVICE = 'figma-cli';
const PLATFORM = process.platform;

function linuxCredPath() {
  const dir = join(homedir(), '.config', 'figma-cli');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, 'credentials.json');
}

function readLinuxCreds() {
  const p = linuxCredPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

function writeLinuxCreds(creds) {
  const p = linuxCredPath();
  writeFileSync(p, JSON.stringify(creds, null, 2), { mode: 0o600 });
  try { chmodSync(p, 0o600); } catch {}
}

/**
 * Save a key securely.
 */
export function saveKey(name, value) {
  if (PLATFORM === 'darwin') {
    // Delete existing entry first (silently ignore if not found)
    try {
      execSync(`security delete-generic-password -s '${SERVICE}' -a '${name}' 2>/dev/null`, { stdio: 'ignore' });
    } catch {}
    execSync(`security add-generic-password -s '${SERVICE}' -a '${name}' -w '${value.replace(/'/g, "'\\''")}'`, { stdio: 'ignore' });
    return;
  }

  if (PLATFORM === 'win32') {
    // argv, not a command line: a key with & or a space broke or injected before.
    execFileSync('cmdkey', windowsCmdkeyArgs(SERVICE, name, value), { stdio: 'ignore' });
    return;
  }

  // Linux fallback
  const creds = readLinuxCreds();
  creds[name] = value;
  writeLinuxCreds(creds);
}

/**
 * Get a key. Returns null if not found.
 */
export function getKey(name) {
  if (PLATFORM === 'darwin') {
    try {
      return execSync(`security find-generic-password -s '${SERVICE}' -a '${name}' -w 2>/dev/null`, { encoding: 'utf-8' }).trim();
    } catch {
      return null;
    }
  }

  if (PLATFORM === 'win32') {
    try {
      const output = execSync(`cmdkey /list:${SERVICE}:${name}`, { encoding: 'utf-8' });
      // cmdkey /list doesn't actually show the password, so we use PowerShell
      const ps = execSync(
        `powershell -Command "[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR((Get-StoredCredential -Target '${SERVICE}:${name}').Password))"`,
        { encoding: 'utf-8' }
      ).trim();
      return ps || null;
    } catch {
      return null;
    }
  }

  // Linux fallback
  const creds = readLinuxCreds();
  return creds[name] || null;
}

/**
 * Delete a key.
 */
export function deleteKey(name) {
  if (PLATFORM === 'darwin') {
    try {
      execSync(`security delete-generic-password -s '${SERVICE}' -a '${name}' 2>/dev/null`, { stdio: 'ignore' });
    } catch {}
    return;
  }

  if (PLATFORM === 'win32') {
    try {
      execSync(`cmdkey /delete:${SERVICE}:${name}`, { stdio: 'ignore' });
    } catch {}
    return;
  }

  const creds = readLinuxCreds();
  delete creds[name];
  writeLinuxCreds(creds);
}

/**
 * Mask a key for display: sk-ant-...xxxx
 */
export function maskKey(value) {
  if (!value) return '(not set)';
  if (value.length <= 12) return '****';
  return value.slice(0, 7) + '...' + value.slice(-4);
}

/**
 * Prompt for a key securely (hidden input with asterisks).
 * Returns the entered value.
 */
/** argv for `cmdkey` on Windows — the secret stays one argument. */
export function windowsCmdkeyArgs(service, name, value) {
  return [`/generic:${service}:${name}`, `/user:${service}`, `/pass:${value}`];
}

/**
 * Apply one stdin chunk to the hidden prompt's state. A paste delivers the key AND its Enter
 * in one chunk; comparing the whole chunk with '\r' never matched it, and the prompt hung.
 * Pure, so the test can feed it chunks. `echoed` is how many asterisks to print (negative:
 * how many to erase).
 */
export function consumeKeyChunk(input, chunk) {
  let echoed = 0;
  for (const ch of chunk) {
    if (ch === '\r' || ch === '\n') return { input, done: true, echoed };
    if (ch === '\u0003') return { input, done: false, interrupted: true, echoed };
    if (ch === '\u007f' || ch === '\b') { if (input.length > 0) { input = input.slice(0, -1); echoed--; } continue; }
    input += ch;
    echoed++;
  }
  return { input, done: false, echoed };
}

export function promptKeySecure(questionText) {
  return new Promise((resolve) => {
    process.stdout.write(questionText);
    const stdin = process.stdin;
    // Without a TTY there is no raw mode (setRawMode is undefined on a pipe): read a line.
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      let buf = '';
      stdin.setEncoding('utf-8');
      stdin.on('data', (d) => { buf += d; });
      stdin.on('end', () => resolve(buf.split(/\r?\n/)[0] || ''));
      stdin.resume();
      return;
    }
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');
    let input = '';
    const onData = (chunk) => {
      const r = consumeKeyChunk(input, chunk);
      input = r.input;
      if (r.echoed > 0) process.stdout.write('*'.repeat(r.echoed));
      else if (r.echoed < 0) process.stdout.write('\b \b'.repeat(-r.echoed));
      if (r.interrupted) {
        process.stdout.write('\n');
        process.exit(0);
      }
      if (r.done) {
        stdin.setRawMode(wasRaw || false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input);
      }
    };
    stdin.on('data', onData);
  });
}
