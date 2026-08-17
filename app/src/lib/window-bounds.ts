import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Where the window was last time. Pure enough to unit-test: `clampBounds` takes the work
 * areas as data rather than asking Electron, so the "monitor was unplugged" case can be
 * exercised without a screen.
 */
export interface Bounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const BOUNDS_FILE = path.join(os.homedir(), '.figma-ds-cli', 'panel-window.json');

export const DEFAULT_BOUNDS: Bounds = { width: 480, height: 720 };

const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;

export function loadBounds(file = BOUNDS_FILE): Bounds {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_BOUNDS };
    const b = raw as Partial<Bounds>;
    if (typeof b.width !== 'number' || typeof b.height !== 'number') return { ...DEFAULT_BOUNDS };
    return {
      x: typeof b.x === 'number' ? b.x : undefined,
      y: typeof b.y === 'number' ? b.y : undefined,
      width: b.width,
      height: b.height
    };
  } catch {
    return { ...DEFAULT_BOUNDS };
  }
}

export function saveBounds(bounds: Bounds, file = BOUNDS_FILE): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(bounds) + '\n');
  } catch {
    // A window position is not worth an error dialog.
  }
}

/**
 * Keeps a remembered window reachable. A panel parked on a monitor that is no longer
 * attached would otherwise open off-screen — visible in the window list, unreachable with
 * the mouse, and indistinguishable from a crash.
 */
export function clampBounds(bounds: Bounds, workAreas: WorkArea[]): Bounds {
  const width = Math.max(MIN_WIDTH, Math.round(bounds.width));
  const height = Math.max(MIN_HEIGHT, Math.round(bounds.height));

  if (bounds.x === undefined || bounds.y === undefined || workAreas.length === 0) {
    return { width, height };
  }

  const visible = workAreas.some((area) => {
    const right = Math.min(bounds.x! + width, area.x + area.width);
    const bottom = Math.min(bounds.y! + height, area.y + area.height);
    const overlapX = right - Math.max(bounds.x!, area.x);
    const overlapY = bottom - Math.max(bounds.y!, area.y);
    // A sliver is not enough: the title bar has to be grabbable.
    return overlapX >= 80 && overlapY >= 40;
  });

  if (visible) {
    return { x: Math.round(bounds.x), y: Math.round(bounds.y), width, height };
  }

  const primary = workAreas[0];
  return {
    x: Math.round(primary.x + Math.max(0, primary.width - width)),
    y: Math.round(primary.y),
    width,
    height: Math.min(height, primary.height)
  };
}
