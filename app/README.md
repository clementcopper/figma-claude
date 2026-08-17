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

The window floats above other windows, remembers its position, and is toggled with
**⌘⌥C**. Closing it ends the session; the tab's process belongs to the window.

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

`cwd` is worth setting: Claude Code stores its session history per directory, so a fixed
working directory is what makes `--resume` find yesterday's conversation.

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
