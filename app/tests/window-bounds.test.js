import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clampBounds,
  loadBounds,
  saveBounds,
  DEFAULT_BOUNDS
} from '../dist/lib/window-bounds.mjs';

const laptop = { x: 0, y: 25, width: 1680, height: 1025 };
const external = { x: 1680, y: 0, width: 2560, height: 1415 };

describe('clampBounds', () => {
  it('keeps a window that is on screen', () => {
    const bounds = { x: 1100, y: 40, width: 480, height: 800 };
    assert.deepStrictEqual(clampBounds(bounds, [laptop]), bounds);
  });

  // The case this exists for: the panel was parked on a monitor that is now unplugged.
  // Restoring those coordinates puts it somewhere unreachable, which reads as a crash.
  it('pulls a window back when its display is gone', () => {
    const onExternal = { x: 3000, y: 200, width: 480, height: 800 };
    const result = clampBounds(onExternal, [laptop]);
    assert.strictEqual(result.x, laptop.x + laptop.width - 480);
    assert.strictEqual(result.y, laptop.y);
    assert.strictEqual(result.width, 480);
  });

  it('accepts a window on the second display', () => {
    const onExternal = { x: 3000, y: 200, width: 480, height: 800 };
    assert.deepStrictEqual(clampBounds(onExternal, [laptop, external]), onExternal);
  });

  it('rejects a sliver: the title bar has to stay grabbable', () => {
    const almostOff = { x: 1660, y: 40, width: 480, height: 800 };
    const result = clampBounds(almostOff, [laptop]);
    assert.notStrictEqual(result.x, almostOff.x);
  });

  it('enforces the minimum size', () => {
    const tiny = { x: 100, y: 100, width: 10, height: 10 };
    const result = clampBounds(tiny, [laptop]);
    assert.strictEqual(result.width, 320);
    assert.strictEqual(result.height, 240);
  });

  it('drops the position when there is none, and lets Electron centre it', () => {
    const result = clampBounds({ width: 480, height: 720 }, [laptop]);
    assert.deepStrictEqual(result, { width: 480, height: 720 });
  });

  it('survives an empty display list', () => {
    const result = clampBounds({ x: 10, y: 10, width: 480, height: 720 }, []);
    assert.deepStrictEqual(result, { width: 480, height: 720 });
  });
});

describe('loadBounds / saveBounds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'panel-bounds-'));

  it('round-trips', () => {
    const file = join(dir, 'ok.json');
    saveBounds({ x: 5, y: 6, width: 500, height: 900 }, file);
    assert.deepStrictEqual(loadBounds(file), { x: 5, y: 6, width: 500, height: 900 });
    assert.ok(readFileSync(file, 'utf8').endsWith('\n'));
  });

  it('falls back to the default when the file is missing', () => {
    assert.deepStrictEqual(loadBounds(join(dir, 'nope.json')), DEFAULT_BOUNDS);
  });

  it('falls back when the file is garbage', () => {
    const file = join(dir, 'garbage.json');
    writeFileSync(file, 'not json at all');
    assert.deepStrictEqual(loadBounds(file), DEFAULT_BOUNDS);
  });

  it('falls back when the size is missing', () => {
    const file = join(dir, 'partial.json');
    writeFileSync(file, JSON.stringify({ x: 1, y: 2 }));
    assert.deepStrictEqual(loadBounds(file), DEFAULT_BOUNDS);
  });
});
