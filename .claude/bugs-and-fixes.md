# Bugs and Fixes History

## Variable Binding Gray Fallback (f8d519b)
**Symptom**: All components rendered with gray `rgb(128,128,128)` fills
**Cause**: Variable loader searched for `c.name === 'shadcn'` but collections are named `shadcn/primitives` and `shadcn/semantic`
**Fix**: Changed to `c.name.startsWith('shadcn')` and iterate all matching collections
**Location**: Two places in figma-client.js (render-batch ~line 357, single render ~line 1090)

## Content Overflow / Fixed Height (f8d519b)
**Symptom**: Settings Panel content overflows frame, gets clipped
**Cause**: Without explicit `h`, root frame defaults to `h=200` with FIXED sizing
**Fix**: When no explicit height, use `primaryAxisSizingMode = 'AUTO'` (HUG) instead of FIXED. Axis depends on layout direction (VERTICAL: primary=height, HORIZONTAL: primary=width)
**Location**: Two code paths - render-batch and single render with var:

## Self-Closing Frame Parser (3353bbd)
**Symptom**: Floating gray rectangles appearing as siblings instead of nested children
**Cause**: `frameOpenRegex` (`/<Frame...>/`) matched self-closing `<Frame ... />` because `>` at end of `/>` matched
**Fix**:
1. Parse open/close Frame tags FIRST, then self-closing ones outside consumed ranges
2. Skip self-closing in frameOpenRegex: `if (match[0].endsWith('/>')) continue`
3. Non-greedy regex in extractContent: `[^>]*?` instead of `[^>]*`

## FILL Before appendChild (c69d448)
**Symptom**: "FILL can only be set on children of auto-layout frames" error
**Cause**: `layoutSizingHorizontal = 'FILL'` set before `appendChild()`
**Fix**: Move FILL sizing assignment after appendChild call

## Default Padding on Nested Frames (c69d448)
**Symptom**: Components look broken with unexpected spacing
**Cause**: Default padding 16/10 applied to ALL nested frames (intended only for buttons)
**Fix**: Changed defaults to 0/0: `fPx = item.px !== undefined ? item.px : (fP !== null ? fP : 0)`

## grow={1} Using Deprecated API (c69d448)
**Symptom**: grow not working correctly, vertical overflow
**Cause**: Used deprecated `layoutGrow` instead of `layoutSizingHorizontal/Vertical = 'FILL'`
**Fix**: Map grow based on parent flex direction using new API

## Old vs New Figma API Conflict (c69d448)
**Symptom**: Sizing conflicts between old and new API
**Cause**: Mixed use of `primaryAxisSizingMode`/`counterAxisSizingMode` (old) and `layoutSizingHorizontal`/`layoutSizingVertical` (new)
**Fix**: Use `layoutSizingHorizontal`/`layoutSizingVertical` for children, keep `primaryAxisSizingMode`/`counterAxisSizingMode` for root frame self-sizing only

## `connect` Deadlock: "Quit Figma (Cmd+Q)" Forever (2026-08-19)
**Symptom**: `connect` printed "Figma is running, but the debug port is not open. Quit Figma (Cmd+Q), then run connect again." Quitting Figma changed nothing — the same message on every retry, and Figma was never relaunched.
**Cause**: `isFigmaRunning()` used `pgrep -f Figma`. `-f` matches the whole command line, so it hit processes that are not Figma Desktop: `~/Library/Application Support/Figma/FigmaAgent.app/.../figma_agent` (Figma's updater, running while Figma is closed) and `/Applications/FigmaClaude.app` plus its three helpers. `figmaRunning` was therefore always true, `resolveConnectAction({cdpReachable: false, figmaRunning: true})` always answered `needs-quit`, and the `start-fresh` branch that calls `startFigma()` was unreachable.
**Fix**: `figmaRunningCommand(platform)` in `src/platform.js` — `pgrep -x Figma` on darwin, `pgrep -x figma` on linux, tasklist filter unchanged on win32. `-x` matches the process name, which is what `killFigmaApp`, `bin/fig-start`, `bin/fig-status` and `app/src/host/figmaActions.ts` already did.
**Location**: `src/platform.js:290` (the only `-f` in the repo), tests in `tests/figma-running.test.js`
**Verified**: after the fix, `isFigmaRunning()` returned false with Figma quit, `connect` took `start-fresh`, and the launched process carried `--remote-debugging-port=9222` with CDP answering `200`.

## `install:app` Reported "Nothing built" on Apple Silicon (2026-08-19)
**Symptom**: `npm run install:app` in `app/` ran the build to completion, then failed with "✗ Nothing built at .../app/release/mac/FigmaClaude.app — run `npm run dist` first."
**Cause**: electron-builder names its output directory after the target arch — `release/mac` on x64, `release/mac-arm64` on arm64. `scripts/install-app.mjs` hardcoded `release/mac`, so the script never found a bundle built on an M-series Mac.
**Fix**: `findBundle()` scans `release/` for the first `mac*/FigmaClaude.app`; the error message now names `release/mac*/`.
**Location**: `app/scripts/install-app.mjs`

## Text Styles Never Matched a Family-Prefixed Weight (2026-08-22, from FEEDBACK.md)
**Symptom**: `render` with `<Text size={43} weight="medium">` warned `no text style for 43px Medium — nearest: "tex/xl/medium" (24px Medium)` and rendered the node with **no** style, although the file has `Website/H3` at exactly 43px Medium.
**Cause**: `matchTextStyle` compared weights with `normalizeWeight`, which only strips separators. Aeonik Pro names its cuts `Text Medium`, so the comparison was `"textmedium" !== "medium"` and no style could ever match. The reporter's diagnosis — matching against the wrong naming scheme (`tex/*` vs `Website/*`) — was wrong; the matcher does not look at names at all.
**Fix**: `weightKey()` in `src/lib/text-styles.js` compares the weight token plus an italic flag (longest word first, so `bold` does not swallow `semibold`); unknown vocabulary falls back to the old exact string. Embedded into the eval prelude next to `normalizeWeight`, or `matchTextStyle` would throw inside Figma.
**Location**: `src/lib/text-styles.js`, embedded via `src/figma-client.js:163`; tests in `tests/text-styles.test.js` and `tests/render-text-styles.test.js`
**Verified**: the reporter's own command in the reporter's own file now prints `text styles: Website/H3`.

## A Flattened `//` Comment Costs 60 Seconds (2026-08-22, from FEEDBACK.md)
**Symptom**: `duplicate <id>` crashed with a raw `Error: spawnSync /bin/sh ETIMEDOUT` after exactly 60s. First diagnosed here as "the sync eval path is dead while the daemon runs, so `duplicate` never worked" — **wrong on both counts**, and the wrong version stood in this file, in `LEARNINGS.md` and in `FEEDBACK.md` before it was measured.
**Cause**: the callers of `figmaUse` build their argument as `` `eval "${code.replace(/"/g,'\\"').replace(/\n/g,' ')}"` ``. That second `replace` puts multi-line code on one line, so a `//` comment swallows everything after it. The daemon answers with a code error, `figmaEvalSync` treats that like a connection problem and falls through to its own CDP connection, and that runs into the 60s `execSync` timeout. The trigger was a new multi-line generator with comments in it — the single-line code the command used before is fine.
**Measured**: `figmaEvalSync('figma.root.children.length')` 76ms · `figmaUse` with single-line code containing `"` 17ms · the pre-change `duplicate` code, non-existent id, 273ms · the same code multi-line with one `//` comment **60049ms, then null**.
**Fix**: the flattening is unnecessary — `figmaUse` parses with `/^eval\s+"(.+)"$/s`, and the `s` flag lets `.` match newlines. `evalArg()` in `src/lib/eval-arg.js` builds the argument without it, and `figmaEvalSync` now rethrows a daemon-reported code error instead of falling through, so the next mistake of this shape costs a message rather than a minute.
**Location**: `src/lib/eval-arg.js`, `src/lib/cli-core.js` (`figmaEvalSync`), the `figmaUse` call sites in `src/commands/*.js`; tests in `tests/eval-arg.test.js`
**Also**: `duplicate` was moved to `fastEval` while this was misdiagnosed. That stands — no string round-trip, no flattening — and it grew two real improvements on the way: other pages are loaded only when the first lookup misses (`loadAllPagesAsync()` up front outlasts the budget on a file with 5235 instances), and the clone of a node inside an instance is re-parented next to the outermost instance. Tests in `tests/duplicate-cmd.test.js`.

## `run` Never Got the Silence Hint `eval` Got (2026-09-01, from FEEDBACK.md)

**Symptom:** `figma-cli run dump.js`, where the script writes with `console.log`, ends with no
output and no error — indistinguishable from a throw or a dead connection. Reported from the
panel, six weeks after the identical `eval` report was closed.

**Cause:** two commands, one decision, two copies. `eval` (`src/commands/export-eval.js`) was
given `evalSilenceHint` in August; `run`, twenty lines below it, kept its own `if` and never
imported the helper. `REFERENCE.md` documented the behavior under a heading that names both
commands and claimed "It now says so" — true for one of them. `run` had also missed `--timeout`
and still hand-rolled the `eval "…"` argument that `src/lib/eval-arg.js` exists to build, and it
tested `result !== undefined` where `eval` tested for `null` too, so a `null` return printed the
bare word `null`.

**Fix:** `formatEvalOutput(code, result)` in `src/lib/eval-output.js` — one decision both
commands call, plus `evalTimeoutMs`/`printEvalResult`/`printEvalError` shared in the command
module. `run` gained `--timeout` and uses `evalArg`. Verified live against a connected Figma: the
logging script now prints the hint, the returning script prints the file name.

## `spawnSync /bin/sh ETIMEDOUT` Named a Shell, Not a State (2026-09-01, from FEEDBACK.md)

**Symptom:** in a panel session after a long pause, any `figma-cli run <file>` printed
`✗ spawnSync /bin/sh ETIMEDOUT` and nothing else. The only advice the CLI has ever printed names
`figma-ds-cli connect` — the legacy alias, and a command a panel session is told not to run.

**Cause:** the 60 s `execSync` ceilings inside `figmaEvalSync` surface their errno verbatim, and
the two `Not connected to Figma` blocks in `src/lib/cli-core.js` were hardcoded strings written
before the panel existed.

**Fix:** `src/lib/connection-help.js` — `connectAdvice({ panel })` and
`explainEvalError(message, { panel })`, pure, with `inPanel()` reading the `FIGMACLAUDE=1` the
panel already exports. In the panel the advice names the toolbar's Figma menu → Connect; in a
terminal it names `status`, `daemon restart` and `connect`. An error that is not about the
connection passes through untouched.

**Found while fixing it, and it changed the wording:** the daemon answered `/health` with
`cdp:false` while a fresh `FigmaClient` connected to the same Figma in the same second — a
daemon holds one CDP link, fixed at startup, and outlives it. So `fetch failed` cannot tell a
stopped daemon from a wedged one, and the message says "The request never reached Figma" rather
than claiming Figma is gone.

## `items="end"` on a Column Cannot Move Text (2026-09-01, from FEEDBACK.md)

**Symptom:** `<Frame flex="col" items="end" w="fill"><Text>…</Text></Frame>` measures
`counterAxisAlignItems=MAX` and the text still stands left. Two rebuilds of a status bar were
spent on it.

**Cause:** not a bug — `generateChildrenCode` (`src/figma-client.js`) sets
`layoutSizingHorizontal='FILL'` on any `<Text>` with no width of its own inside a sized column,
deliberately, so Safe Mode wraps it. A FILLed child spans the column, so the column's cross-axis
alignment has nothing left to move. `align="right"` on the `<Text>` works and was reachable only
through the unknown-prop warning: `docs jsx-syntax` never showed the prop.

**Fix:** documented in `docs/FIGMA-USAGE.md`, and `render` now warns. `autoFillDefeatsAlign`
(`src/lib/text-autofill.js`, pure) + `FigmaClient.validateTextAlignment`, printed next to the
unknown-prop warnings in `src/commands/render.js`. The layout is unchanged — FILL is load-bearing
for wrapping — so no parity run was needed.
