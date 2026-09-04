/**
 * Figma Patch
 *
 * Patches Figma Desktop to enable remote debugging.
 * Newer Figma versions block --remote-debugging-port by default.
 */

import { readFileSync, writeFileSync, accessSync, constants, renameSync, unlinkSync } from 'fs';
import { dirname, basename } from 'path';
import { execSync } from 'child_process';
import {
  getAsarPath as platformGetAsarPath,
  getFigmaBinaryPath as platformGetFigmaBinaryPath,
  getFigmaCommand as platformGetFigmaCommand
} from './platform.js';

const DEFAULT_CDP_PORT = 9222;

/** A whole port number in range, or null. `parseInt` took "9333abc" as 9333 and "abc" as NaN → 9222, silently. */
export function parseCdpPort(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n < 65536 ? n : null;
}

export function getCdpPort() {
  return parseCdpPort(process.env.FIGMA_PORT) ?? DEFAULT_CDP_PORT;
}

// The string that blocks remote debugging
const BLOCK_STRING = Buffer.from('removeSwitch("remote-debugging-port")');
// The patched string (changes "port" to "Xort" to disable the block)
const PATCH_STRING = Buffer.from('removeSwitch("remote-debugXing-port")');

/**
 * Get the path to Figma's app.asar file
 */
export function getAsarPath() {
  return platformGetAsarPath();
}

/**
 * Check if Figma is patched
 * @returns {boolean|null} true=patched, false=not patched, null=can't determine
 */
export function isPatched() {
  const asarPath = getAsarPath();
  if (!asarPath) return null;

  try {
    const content = readFileSync(asarPath);

    if (content.includes(PATCH_STRING)) {
      return true; // Already patched
    }

    if (content.includes(BLOCK_STRING)) {
      return false; // Needs patching
    }

    return null; // Can't determine (maybe old Figma version)
  } catch {
    return null;
  }
}

/**
 * Check if we have write access to the Figma app.asar file
 * @returns {boolean} true if we can write, false otherwise
 */
export function canPatchFigma() {
  const asarPath = getAsarPath();
  if (!asarPath) return false;

  try {
    accessSync(asarPath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Patch Figma to enable remote debugging
 * @returns {boolean} true if patched successfully
 */
export function patchFigma() {
  const asarPath = getAsarPath();
  if (!asarPath) {
    throw new Error('Cannot detect Figma installation path for this platform');
  }

  // Check write access first
  if (!canPatchFigma()) {
    if (process.platform === 'darwin') {
      throw new Error('No write access to Figma. On macOS 13+ grant your terminal "App Management" (System Settings → Privacy & Security → App Management) — "Full Disk Access" alone does not allow modifying another app. Or use Safe Mode: figma-cli connect --safe');
    } else {
      throw new Error('No write access to Figma. Try running as administrator.');
    }
  }

  patchAsarFile(asarPath);
  resignApp(asarPath);
  return true;
}

/** The .app bundle that owns an app.asar (…/Contents/Resources/app.asar → …/Figma.app). */
export function appPathFromAsar(asarPath) {
  return dirname(dirname(dirname(asarPath)));
}

// On macOS, re-sign the app we actually patched — not a hardcoded /Applications/Figma.app.
function resignApp(asarPath) {
  if (process.platform !== 'darwin') return;
  try {
    execSync(`codesign --force --deep --sign - ${JSON.stringify(appPathFromAsar(asarPath))}`, { stdio: 'ignore' });
  } catch {
    // Codesign might fail but the patch might still work
  }
}

/**
 * Write the archive through a temp file in the same directory and rename it into place.
 * An in-place writeFileSync that was interrupted (crash, full disk) left a truncated app.asar
 * and Figma would not start, with nothing to restore from; a rename either lands or not.
 */
function writeAsarAtomically(asarPath, content) {
  const tmp = `${asarPath}.figma-cli-tmp`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, asarPath);
  } catch (e) {
    try { unlinkSync(tmp); } catch {}
    throw e;
  }
}

/** Byte-patch one archive. Exported for the test, which runs it on a fake file. */
export function patchAsarFile(asarPath) {
  const content = readFileSync(asarPath);
  const blockIndex = content.indexOf(BLOCK_STRING);
  if (blockIndex < 0) {
    if (content.includes(PATCH_STRING)) return true; // Already patched
    throw new Error(`Could not find the string to patch in ${basename(asarPath)}. Figma version may be incompatible (unknown layout).`);
  }
  PATCH_STRING.copy(content, blockIndex);
  writeAsarAtomically(asarPath, content);
  return true;
}

/** Reverse of patchAsarFile. */
export function unpatchAsarFile(asarPath) {
  const content = readFileSync(asarPath);
  const patchIndex = content.indexOf(PATCH_STRING);
  if (patchIndex < 0) {
    if (content.includes(BLOCK_STRING)) return true; // Already in original state
    throw new Error('Could not find the patched string. Figma may not have been patched by this tool.');
  }
  BLOCK_STRING.copy(content, patchIndex);
  writeAsarAtomically(asarPath, content);
  return true;
}

/**
 * Unpatch Figma to restore original state (re-enables remote debugging block)
 * @returns {boolean} true if unpatched successfully
 */
export function unpatchFigma() {
  const asarPath = getAsarPath();
  if (!asarPath) {
    throw new Error('Cannot detect Figma installation path for this platform');
  }

  // The same write-access check patchFigma makes: without it a missing App Management
  // permission surfaced as a raw EACCES.
  if (!canPatchFigma()) {
    throw new Error(process.platform === 'darwin'
      ? 'No write access to Figma. Grant your terminal "App Management" (System Settings → Privacy & Security → App Management) and try again.'
      : 'No write access to Figma. Try running as administrator.');
  }
  unpatchAsarFile(asarPath);
  resignApp(asarPath);
  return true;
}

/**
 * Get the command to start Figma with remote debugging
 */
export function getFigmaCommand(port = getCdpPort()) {
  return platformGetFigmaCommand(port);
}

/**
 * Get the path to Figma binary
 */
export function getFigmaBinaryPath() {
  return platformGetFigmaBinaryPath();
}

export default {
  getAsarPath,
  isPatched,
  canPatchFigma,
  patchFigma,
  unpatchFigma,
  getFigmaCommand,
  getFigmaBinaryPath,
  getCdpPort
};
