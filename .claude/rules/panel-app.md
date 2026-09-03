---
paths:
  - "app/**"
  - "bin/**"
---

# Claude Panel (`app/`, Electron) and `bin/` launchers

Distilled from `LEARNINGS.md` § Claude Panel. Stories there (partly German). See `app/PORTED-FROM.md` before touching `app/media/`.

## Environment and spawning

- **`ELECTRON_RUN_AS_NODE=1` is inherited** by every terminal that launched an Electron app; `require('electron')` then fails as "Cannot find module 'electron'" and `open App.app` from such a shell exits silently. Deleted in `run-electron.mjs` **and** in the PTY environment. Never put it in the PTY env.
- **PATH is not PATH.** From the Dock an app inherits launchd's `/usr/bin:/bin:/usr/sbin:/sbin`; ask the login shell once and pass the value on. And `zsh -l -c` does not read `.zshrc` (where installers put `~/.local/bin`): use `-lic` plus a marker, because interactive shells print banners.
- **A shell alias exists in no PTY, and `figma-cli` is not on PATH here** (checkout). Commands written for Daniel or the prompt need `node ~/figma-cli/src/index.js` or real resolution; a missing command looks like a crash (node-pty exits 1 silently), so resolve before spawn and name it.
- **In Claude Code a bare line is a prompt.** A command typed into the input needs `!` in front; only Claude Code, not `gemini`/`aider`/a shell.
- **Compare paths exactly:** `tr ':' '\n'` plus `grep -Fx`; `grep -c ".local/bin"` matched `/usr/local/bin` and reported a PATH as fine that was missing exactly that entry.
- **The panel finds the CLI three ways and all can be empty** (PATH, `repoPath` in `~/.figma-ds-cli/config.json`, the bundle's parent dir). `figmaCli` in `panel.json` may be a checkout path; the resolver appends `src/index.js`. The resolved path is cached per process (`cli()` in `app/src/main.ts`): restart the app after changing `panel.json`.
- **Never replace a running `.app`;** `install:app` quits the app first. electron-builder names the output dir per architecture (`release/mac` vs `release/mac-arm64`), so don't hard-code `release/mac`.

## Packaging and modules

- **`"type": "module"` eats every copied CommonJS file.** Preload (`ERR_REQUIRE_ESM`, blank window) and the statusline producer (`ReferenceError: require is not defined`, silent because Claude Code never shows its `statusLine` stderr) both died of it; rename ported `.js` that uses `require` to `.cjs`. `webContents.on('console-message')` into the log is what made the preload error visible.
- **Named imports from `electron` do not survive CJS bundling** (esbuild wraps into `__toESM(require(...))`, `app` is `undefined`); default import plus destructuring.
- **macOS rasterises SVG itself:** `qlmanage -t -s 1024 -o out file.svg`, then `iconutil -c icns`; simplified drawing for 16/32 px.

## Claude Code integration

- **`claude --settings` takes inline JSON;** "Settings file not found: {…" only means the string was not valid JSON (file is tried first). The status line comes as JSON on the `statusLine` command's stdin, so the panel needs no edit to `~/.claude/settings.json`; the user's own command is chained via `CLAUDE_PANEL_DELEGATE`.
- **Inline `style` beats the stylesheet you just fixed.** `main.ts` writes `element.style.display = 'block'` on every tab activation and undid the `flex` centring (0 px above, 7.5 px below); assign `''` instead so the stylesheet wins.
