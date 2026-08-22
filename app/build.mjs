import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

// Two bundles, exactly as the extension had them: one for the host, one for the UI.
// `media/main.ts` is byte-identical to the extension's, so it is bundled the same way.
const targets = [
  {
    entryPoints: [join(ROOT, 'src/main.ts')],
    outfile: join(ROOT, 'dist/main.cjs'),
    platform: 'node',
    format: 'cjs',
    // Electron provides the first, node-pty is a native module and must stay external.
    external: ['electron', 'node-pty']
  },
  {
    // Pure logic, bundled as ESM so `node --test` can import it without Electron.
    entryPoints: [join(ROOT, 'src/lib/window-bounds.ts')],
    outfile: join(ROOT, 'dist/lib/window-bounds.mjs'),
    platform: 'node',
    format: 'esm'
  },
  {
    entryPoints: [join(ROOT, 'src/lib/cli-command.ts')],
    outfile: join(ROOT, 'dist/lib/cli-command.mjs'),
    platform: 'node',
    format: 'esm'
  },
  {
    entryPoints: [join(ROOT, 'src/lib/figma-status.ts')],
    outfile: join(ROOT, 'dist/lib/figma-status.mjs'),
    platform: 'node',
    format: 'esm'
  },
  {
    entryPoints: [join(ROOT, 'src/lib/render-undo.ts')],
    outfile: join(ROOT, 'dist/lib/render-undo.mjs'),
    platform: 'node',
    format: 'esm'
  },
  {
    entryPoints: [join(ROOT, 'src/lib/limit-window.ts')],
    outfile: join(ROOT, 'dist/lib/limit-window.mjs'),
    platform: 'node',
    format: 'esm'
  },
  {
    entryPoints: [join(ROOT, 'src/lib/shell-path.ts')],
    outfile: join(ROOT, 'dist/lib/shell-path.mjs'),
    platform: 'node',
    format: 'esm'
  },
  {
    entryPoints: [join(ROOT, 'src/lib/pty-exit.ts')],
    outfile: join(ROOT, 'dist/lib/pty-exit.mjs'),
    platform: 'node',
    format: 'esm'
  },
  {
    entryPoints: [join(ROOT, 'src/lib/theme-choice.ts')],
    outfile: join(ROOT, 'dist/lib/theme-choice.mjs'),
    platform: 'node',
    format: 'esm'
  },
  {
    entryPoints: [join(ROOT, 'src/lib/project-layout.ts')],
    outfile: join(ROOT, 'dist/lib/project-layout.mjs'),
    platform: 'node',
    format: 'esm'
  },
  {
    entryPoints: [join(ROOT, 'src/lib/cli-shim.ts')],
    outfile: join(ROOT, 'dist/lib/cli-shim.mjs'),
    platform: 'node',
    format: 'esm'
  },
  {
    entryPoints: [join(ROOT, 'src/lib/session-name.ts')],
    outfile: join(ROOT, 'dist/lib/session-name.mjs'),
    platform: 'node',
    format: 'esm'
  },
  {
    entryPoints: [join(ROOT, 'src/lib/limit-broadcast.ts')],
    outfile: join(ROOT, 'dist/lib/limit-broadcast.mjs'),
    platform: 'node',
    format: 'esm'
  },
  {
    entryPoints: [join(ROOT, 'src/lib/zoom-factor.ts')],
    outfile: join(ROOT, 'dist/lib/zoom-factor.mjs'),
    platform: 'node',
    format: 'esm'
  },
  {
    entryPoints: [join(ROOT, 'src/lib/about-panel.ts')],
    outfile: join(ROOT, 'dist/lib/about-panel.mjs'),
    platform: 'node',
    format: 'esm'
  },
  {
    entryPoints: [join(ROOT, 'media/main.ts')],
    outfile: join(ROOT, 'media/main.js'),
    platform: 'browser',
    format: 'iife'
  }
];

mkdirSync(join(ROOT, 'dist'), { recursive: true });

// xterm ships its CSS separately; the UI links it as a plain stylesheet.
copyFileSync(
  join(ROOT, 'node_modules/@xterm/xterm/css/xterm.css'),
  join(ROOT, 'media/xterm.css')
);

for (const target of targets) {
  await build({ ...target, bundle: true, sourcemap: true, logLevel: 'info' });
}

if (watch) {
  console.log('build: watch mode is not wired up yet — rerun `npm run build`.');
}
