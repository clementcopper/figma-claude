# Ported from claude-terminal-panel

Source: [`clementcopper/claude-terminal-panel`](https://github.com/clementcopper/claude-terminal-panel), MIT
Commit: `b89760a514de29888a8b8b9bf39d060a2047e435` (2026-08-15)

Same author, same licence (`LICENSE-claude-terminal-panel`). This is the VS Code panel running
next to Figma instead of inside an editor, so the UI is not reimplemented — it is copied, and
only the parts that depended on VS Code are replaced.

## Copied byte-identical

| File | Note |
|---|---|
| `media/main.ts` | the whole UI: tabs, toolbar, status line, prompt indicator, link provider |
| `media/styles.css` | |
| `media/types.ts` | |
| `src/host/types.ts` | |
| `src/host/messageHandlers.ts` | the UI↔host protocol |
| `src/host/terminalStateManager.ts` | |
| `src/host/promptDetector.ts` | |
| `src/host/commandHelpParser.ts`, `src/host/helpExecutor.ts` | not wired up yet |
| `resources/panel-statusline.cjs` | the status line producer Claude Code runs (renamed from `.js`, see below) |

## Changed, and why

| File | Change |
|---|---|
| `src/host/statusLineWatcher.ts` | snapshot directory renamed to `figma-claude-panel` so the two panels cannot read each other's tabs |
| `src/host/ptyManager.ts` | no `vscode.workspace.workspaceFolders`, no QuickPick for the folder, app directory instead of `extensionUri`, and `ELECTRON_RUN_AS_NODE` deleted from the PTY environment |
| `src/host/config.ts` | was `configManager.ts`: same keys and defaults, read from `~/.figma-ds-cli/panel.json` instead of VS Code settings |
| `src/main.ts` | was `ClaudeTerminalViewProvider.ts` + `extension.ts`: same logic, Electron window instead of a webview view |
| `preload.cjs` | new — hands the UI the `acquireVsCodeApi()` shape it expects |
| `media/theme.css` | new — the `--vscode-*` variables VS Code injected, plus the layout the copied CSS cannot know about (it assumes a sidebar, not a window with a top bar) |
| `media/toolbar.js` | new — the four view/title buttons (New Tab, Resume, Continue, Restart) plus the working-directory chip; VS Code contributed those through `package.json`, not through the webview |
| `index.html` | new — the same DOM the provider generated |
| `resources/panel-statusline.cjs` | extension: `.js`. This package is `"type": "module"`, so the CommonJS producer had to be renamed or it died with `ReferenceError: require is not defined` — silently, because Claude Code never surfaces what its statusLine command wrote to stderr |

| `src/host/figmaContext.ts` | replaces `editorContextTracker.ts`: same `editorContext` message and the same click-to-insert row, but the context is the Figma file, page and selection, read through the CLI daemon |

## Not ported, deliberately

`commandInputPicker.ts` and `pathAutocompleteProvider.ts` — VS Code QuickPick UI, about 730
lines, for starting a tab with a different CLI or extra flags. A window has no QuickPick, and
the case is covered by `args` in `panel.json` or by typing in the terminal. The tab strip's
"New Terminal with Custom Command" button is therefore hidden in `media/theme.css` rather than
left to do something other than it promises.

The top bar also drops the extension's "New Terminal Tab": the tab strip already carries a `+`
that sends the same message, and two identical buttons forty pixels apart are not two
features.

## Re-porting later

Improvements to the extension come over as a diff:

```bash
git clone https://github.com/clementcopper/claude-terminal-panel /tmp/ctp
diff -u /tmp/ctp/media/main.ts app/media/main.ts
```

Byte-identical files should stay that way — anything that has to change belongs in the table above.
