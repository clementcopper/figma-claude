# Claude Panel

Claude Code in a window next to Figma, instead of a terminal beside it. Built by
[Clement Copper](https://github.com/clementcopper) from two projects that each do half of it:

```
silships/figma-cli                 drives Figma Desktop over CDP
nolikzero/claude-terminal-panel    the AI terminal panel for VS Code
        ⇩   combined, ported to Electron and extended here
FigmaClaude
```

The panel's UI — tabs, toolbar, status line — is copied byte-identical from
[`claude-terminal-panel`](https://github.com/nolikzero/claude-terminal-panel) (MIT, © 2025
nolikzero) by way of [this fork](https://github.com/clementcopper/claude-terminal-panel); see
`PORTED-FROM.md` for the file-by-file list. Written here: the Electron shell and its preload
shim, the top bar, the working-directory picker, the bridge to the CLI daemon, the icon and the
packaging.

```bash
cd app
npm install
npm run rebuild     # node-pty against Electron's ABI, once per Electron version
npm start           # run from source
npm run dist        # build release/mac/FigmaClaude.app
npm run install:app # build it and put it in /Applications
```

Installed, it is an ordinary app: Spotlight, Dock, Launchpad. It carries its own copy of the
code, so after changing anything here run `npm run install:app` again — `npm start` runs the
source directly and is the faster loop while working on the panel.

Running from source, the Dock says "Electron" — that name comes from the bundle's Info.plist,
and only the packaged build has its own. Everything else (menu bar, window, Dock icon) says
FigmaClaude either way.

An ordinary window: move and resize it as usual, it remembers where it was, and **⌘⌥C**
shows or hides it. In full screen the bar drops the 62 px it keeps clear of the traffic lights,
since macOS hides them there — maximising by double-clicking the bar keeps them, and keeps the
space. Closing it ends the session — the tab's process belongs to the window.

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

## Figma

The top bar's two dots are the two halves that fail separately: the CLI daemon, and a live
connection into Figma behind it. Daemon up with Figma gone is the state that otherwise looks
like "commands silently do nothing". Next to them stands the open file.

Everything comes from the daemon (`/health` plus one `eval` for the selection, polled every
2.5 s while the window has focus) — the panel opens no connection of its own, so it can never
show more than `figma-cli` can.

It is a readout, not a control — while the connection is up it is not clickable at all. It
becomes a button the moment Figma is gone: a click then asks the daemon to rebuild its CDP
connection, which is all it takes after a Figma restart, and answers in place of the file name
(`Reconnecting…` → `Connected`). Only if that fails is `figma-cli connect` needed — patching,
starting Figma, the macOS permission — and it is written into the input unsent, because those
questions belong in the terminal. In a Claude Code tab it arrives as `!figma-cli connect`: a bare
line is a *prompt* there, and Claude would start working on it; the `!` is what makes it a shell
command. Tabs running anything else get the command without the prefix, since only Claude Code
reads it that way.

Which command that is gets looked up rather than assumed. `figma-cli` on PATH wins; otherwise set
`figmaCli` in `panel.json` to a checkout and the panel writes `node <checkout>/src/index.js`
instead. Found nothing, it says so rather than typing a command that cannot run:

```json
{ "figmaCli": "~/figma-cli" }
```

The simplest fix is to have the binary at all — `npm link` once in the CLI's checkout puts
`figma-cli` on PATH for everything, this app included.

With something selected in Figma, a row appears above the status line. Clicking it writes the
selection into the prompt without sending it:

```
Figma selection: "Hero - Visual" (FRAME 298:4001), "Button" (INSTANCE 675:5292)
```

Ids, not just names — they are what `figma-cli get`, `set` and `render --parent` take.

## Status line

Model, effort, context bar and rate limits cannot be read from the terminal stream — the panel
only sees PTY bytes. Claude Code hands them to its `statusLine` command instead, so the panel
passes its own producer per session via `claude --settings`. **Your `~/.claude/settings.json` is
not touched**, and your own status line keeps running: the producer calls it and prints its
output unchanged.

## Development

`PANEL_CAPTURE=<file>` writes a PNG of the window once it has drawn (`PANEL_CAPTURE_DELAY=<ms>`
to wait longer), and `PANEL_DEBUG=1` prints the terminal's geometry — wrapper height, row
height, row count, status-line height. Both exist because judging layout from a screenshot is
guesswork: the cut-off `auto mode on` line turned out to be 56 rows of 16.5 px in a 913 px box,
which no amount of looking would have told you.

## Known

- `ELECTRON_RUN_AS_NODE` is deleted before spawning, and `npm start` goes through
  `run-electron.mjs` for the same reason: a terminal opened by an Electron app (VS Code, Claude
  Code) carries that variable, and it turns Electron into a plain Node process.
- `node-pty` is native. After an Electron upgrade, run `npm run rebuild`.
- Unsigned. A packaged build needs right-click → Open on first launch.
- `open path/to/FigmaClaude.app` from a terminal hands the app that terminal's environment. From
  one that carries `ELECTRON_RUN_AS_NODE` the app starts as plain Node and exits silently —
  launch it from Finder or the Dock instead.
- Started from the Dock, an app inherits launchd's PATH — `/usr/bin:/bin:/usr/sbin:/sbin` —
  which holds neither `claude` nor anything from npm or Homebrew, so the same build worked from
  a terminal and not from the Dock. The panel now asks the login shell for its PATH once
  (`$SHELL -l -c 'printf %s "$PATH"'`) and hands that to the terminal.
- The icon lives in `build/icon-src/variants.mjs` as SVG; `build/README.md` has the two commands
  that turn it into `icon.png` and `icon.icns`.
