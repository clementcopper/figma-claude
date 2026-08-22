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

The panel asks your login shell what PATH a real terminal has — **interactively** (`zsh -lic`),
because zsh reads `.zshrc` only in interactive shells, and that is where installers put their
line: Claude Code's own writes `export PATH="$HOME/.local/bin:$PATH"` there. Probed without it,
`claude` was missing from the PATH the terminals got, and every tab exited with a silent code 1.
`~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin` are appended as a fallback, and a
command that still cannot be found is named in the tab.

`install:app` quits a running FigmaClaude before it replaces the bundle, and says so. That is
not politeness: replacing the bundle underneath a running instance leaves the window alive but
kills its terminals — every new tab then exits instantly with code 1 and prints nothing. If it
cannot quit the app (an open dialog, say), it stops instead of deleting anything.

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
like "commands silently do nothing". Next to them stand the bound file and the open page,
the way Figma's own breadcrumb reads: `Designdone/Landingpage`.

What it shows comes from the daemon (`/health` plus one `eval` for file, page and selection,
polled every 2.5 s while the window has focus); what it does runs the CLI as a child process. The
panel opens no connection of its own, so it can never do more than `figma-cli` can.

Clicking it opens the menu that holds every figma-cli action the panel offers, so the terminal
below stays Claude's:

| Entry | What runs |
|---|---|
| **Connect** | `figma-cli connect` in the configured mode. With the debug port missing but Figma running, a dialog asks first — the CLI never quits Figma, and only you know whether that is safe. |
| **Restart / Stop daemon** | `figma-cli daemon restart` and `daemon stop`. Restart also re-pins the bound file. |
| **Bound file** | `figma-cli files` lists what is open; picking one restarts the daemon with `FIGMA_FILE` set. Appears only when more than one file is open. Without it the daemon binds to whichever file happened to be first — silently the wrong one. |
| **Undo last render** | Removes the nodes of the most recent `render` / `render-batch`, read from `~/.figma-ds-cli/last-render.json`. Only those ids; nothing on the canvas is searched for or guessed at. Disabled when the file is gone. |
| **Prepare this folder** | `figma-cli init-agent --tool claude --no-setup` in the **active tab's** working directory (named under the button). Writes `.claude/rules/figma-cli.md` — see below. |
| **Mode** | Yolo, Safe or Browser; switching reconnects. |

Two places in the project, and the split is deliberate:

```
project/
├── CLAUDE.md                      # yours — never opened, never edited
├── .claude/rules/figma-cli.md     # the rules; delete the file to remove them
└── FigmaClaude/                   # everything the CLI generates
    ├── DESIGN.md                  # figma-cli extract
    ├── DESIGN-structure/          # extract --split
    └── rules/                     # rules gen
```

**Not `AGENTS.md`.** Claude Code reads `CLAUDE.md` and the files in `.claude/rules/`; `AGENTS.md`
it does not load ([docs](https://code.claude.com/docs/en/memory)). A rules file loads at session
start on its own, so no `CLAUDE.md` you or another agent maintains has to be touched. The written
rules also leave out "run `figma-cli connect` once per session" — connecting is a button here, and
an instruction that contradicts the project's own guidance gets resolved arbitrarily.

`FigmaClaude/` is visible rather than a dot-folder on purpose: the CLI's own DESIGN.md lookup
scans the working directory plus one level of subdirectories and skips dot-directories.

**Appearance** sits in the same menu: System, Light, Dark. System is the default and follows
macOS live — switch the system setting and the bar, the tabs, the menu *and the terminal* change
without a restart. The palette is Figma's own light UI, read out of the running app rather than
guessed (`#fff`, `#f5f5f5`, `#e6e6e6`, text `#000000e5`, brand `#0d99ff`); the terminal gets a
second, complete ANSI set, because the dark one is unreadable on white — bright yellow `#f5f543`
disappears entirely. Figma itself keeps its menus dark in light mode, so a dark panel next to a
light Figma was never wrong either; it is a much larger surface, which is the whole argument.

Results appear as a line in the menu, not in the terminal. Patching Figma needs macOS "App
Management" **for FigmaClaude itself** — the app spawns the CLI, so the permission follows the
app, not your terminal. When it is missing, the menu says so and offers to open the settings pane.
Safe Mode needs no permission at all.

Which command all of this runs gets looked up rather than assumed: `figmaCli` from `panel.json`
first, then `figma-cli` on PATH, then a checkout — `repoPath` from `~/.figma-cli/config.json`
(fig-start writes it) or the repo this app sits in.

```json
{ "figmaCli": "~/figma-cli" }
```

When the CLI is a checkout, the panel writes `~/.figma-ds-cli/bin/figma-cli` — a two-line launcher
— and puts that directory on the PATH of the terminals it spawns. That is what makes the
`figma-cli …` commands in `AGENTS.md` work in Claude's tab without installing anything globally or
touching your shell files. Delete the file to undo it.

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

The rate limits are shared between tabs and windows through `limits.json` under the snapshot
directory, and not only as a starting value: a tab whose Claude is idle would otherwise keep
showing a percentage another tab has long superseded. That number exists only in Claude's
payload, so unlike the reset countdown it cannot be recomputed from the clock. The panel watches
that file and polls it every 30 s, and hands newer limits to every tab whose own snapshot
predates them — the tab's timestamp stays as it was, since its model and context really are old
and the limits row is exempt from the stale dimming.

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
