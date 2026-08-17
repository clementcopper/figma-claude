# Claude Panel

Claude Code in a floating window next to Figma, instead of a terminal beside it. The UI is
[`claude-terminal-panel`](https://github.com/clementcopper/claude-terminal-panel) — same tabs,
same toolbar, same status line — running in Electron rather than VS Code. See `PORTED-FROM.md`.

```bash
cd app
npm install
npm run rebuild     # node-pty against Electron's ABI, once per Electron version
npm start
```

An ordinary window: move and resize it as usual, it remembers where it was, and **⌘⌥C**
shows or hides it. Closing it ends the session — the tab's process belongs to the window.

The top bar carries the four actions the VS Code extension put in the view title — new tab,
resume session, continue last session, restart — and on the left the working directory.

## Configuration

`~/.figma-ds-cli/panel.json`, with the keys the VS Code extension used under `claudeTerminal.*`:

```json
{
  "command": "claude",
  "args": [],
  "cwd": "~/figma-cli",
  "directMode": true,
  "statusLine": true,
  "statusLineProvider": "bundled",
  "statusLineCompactBudget": 5
}
```

`cwd` is what the folder button in the top bar writes. Claude Code stores its session history
per directory, so this is the setting that decides which conversations `--resume` offers. With
no `cwd` set, the panel asks once before it starts the first tab; changing it later restarts the
active tab in the new directory.

## Status line

Model, effort, context bar and rate limits cannot be read from the terminal stream — the panel
only sees PTY bytes. Claude Code hands them to its `statusLine` command instead, so the panel
passes its own producer per session via `claude --settings`. **Your `~/.claude/settings.json` is
not touched**, and your own status line keeps running: the producer calls it and prints its
output unchanged.

## Known

- `ELECTRON_RUN_AS_NODE` is deleted before spawning, and `npm start` goes through
  `run-electron.mjs` for the same reason: a terminal opened by an Electron app (VS Code, Claude
  Code) carries that variable, and it turns Electron into a plain Node process.
- `node-pty` is native. After an Electron upgrade, run `npm run rebuild`.
- Unsigned. A packaged build needs right-click → Open on first launch.
