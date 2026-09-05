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

## Two Copies of the Export Scale, One Promise (2026-09-02, from FEEDBACK.md)

**Symptom:** a 500px status-bar frame came back too small to judge — 36px rings and 9px text
unreadable — and was assumed unfinished until the same node at `verify -s 3` showed it had been
correct. `render --help` says `--verify` "replaces a separate `figma-cli verify` roundtrip".

**Cause, not the reported one:** the report said `--verify` was fixed at 0.5. It was fixed at
**1** — the 250px image came from `figma-cli verify`, whose own default is 0.5. The real defect
was underneath: two independent implementations of the same export. `verify`
(`src/commands/export-eval.js`) clamped against `--max` and Figma's 7500px ceiling; `verifyRendered`
(`src/commands/render.js`) had its own copy that knew only a 2000px cap, hardcoded scale 1, and
took no argument — while the help promised equivalence.

**Fix:** `src/lib/verify-export.js` decides once. `resolveExportScale` is the function,
`exportScaleSnippet` the same rules as source for the plugin-side eval (they cannot import), and
`tests/verify-export.test.js` runs the generated snippet against the function on every case —
because two hand-written copies is precisely what caused this. `render --verify [scale]` now takes
a value on both `render` and `render-batch`, and a clamped scale is reported in the JSON instead
of applied silently. Verified live on `915:5252`: 36px at scale 1, 108px at 3, cleanly capped to
2000px at `-s 100`.

## A Prop That Exists and Is Written Down Nowhere (2026-09-02, from FEEDBACK.md)

**Symptom:** `align=` worked in the parser and appeared in no `REFERENCE.md`, the file with the
most detailed `<Text>` section. Separately, a session set `counterAxisSpacing` through `eval`
because the JSX prop was documented nowhere.

**Cause:** the vocabulary lived as a local constant inside `validateJsxProps`, so it was the
truth about what exists and unreachable to anything that could check that truth. Nothing related
the parser to the docs, so every new prop was one editorial slip away from being invisible.

**Fix:** the list moved to `src/lib/jsx-props.js` (`KNOWN_PROPS`, `ALL_PROPS`, `PROP_ALIASES`) and
`tests/docs-coverage.test.js` holds it against all four documents. The seven props that are
genuinely undocumented today are a **named** allowlist, not a tolerated silence: without it the
check would be red from its first run, and a permanently red line stops being read. The test also
fails when a backlog entry becomes documented, so the list can only shrink.

## Ten `create` Subcommands Answered "unknown command" for Eighteen Days (2026-09-04, review)

**Symptom:** `figma-cli create rect X` → `error: unknown command 'rect'`; same for text, line,
autolayout, group, component, ellipse and their aliases, all documented in REFERENCE.md.

**Cause:** config.js attaches those subcommands to the `create` group that create.js registers.
The lazy loader (17.08.) loads only the module the map names, and the map said
`create: ['create']`. `tests/lazy-command-map.test.js` walked top-level commands only, so a
subcommand that vanished was invisible to it. Nobody reported it: no panel session used `create`.

**Fix:** `create: ['create', 'config']`; the test now records which module contributes
subcommands to which group and was red on the old map. `tests/cli-entry.test.js` runs the real
binary for `create rect --help` and for `figma-cli toString` (which crashed on
`Object.prototype` before `Object.hasOwn`).

## The Plugin's WebSocket Was the One Door Without a Lock (2026-09-04, review)

**Symptom:** none visible. Every HTTP request to the daemon needed Host + token; the `/plugin`
WebSocket server was attached to the same http server and completed the upgrade for anyone.

**Why it matters:** a browser opens a WebSocket to 127.0.0.1 without a CORS preflight, so any
open tab could become `pluginWs`, receive every eval the CLI sent and answer with forged results.

**Fix:** `src/lib/daemon-auth.js` — one rule set for HTTP and upgrade (loopback Host, token in
`?token=` or header, no Origin other than the `null` a sandboxed plugin iframe sends). The plugin
stores the token in clientStorage; `connect --safe` prints it. Probed with a throwaway daemon:
no token / wrong token / real Origin → 403.

## Three Commands Still Called the Binary Removed in 2.1.1 (2026-09-04, review)

`export-jsx` and `export-storybook` took the native path only in Safe Mode and ran
`npx --yes figma-use …` in the default mode; `remove-bg` asked figma-use for its PNG export, so
the file never appeared and every run said "Select an image or frame first"; `raw` was a
passthrough. Native path for both modes, `exportAsync` for remove-bg, `raw` deleted;
`tests/figma-use-remnants.test.js` scans for the next one.

## The Exit-Code Guard Read Only One Spelling of "Failed" (2026-09-05, panel feedback)

**Symptom:** `node bindings 9999:9999 --json` printed `{"ok":false,…}` and exited 0; `tokens add
lab/bad "#zz" -t COLOR` printed a red ✗ and exited 0 — after `tests/exit-codes.test.js` had been
green for a day and `docs scripting-the-cli` promised "exit code is the truth".

**Cause:** the guard's regex matched `chalk.red('✗` with a single quote only. A template
literal (`` chalk.red(`✗ …`) ``) and a `JSON.stringify({ ok: false` line are the same failure
in two other spellings, and neither was looked at.

**Fix:** the regex reads all three, the window is eight lines (`check` explains on two branches
before its one `process.exit(1)`); that made nine silent failures visible at once (blocks,
doctor, rules list, rename-batch among them), all set now. `get` moved from `figmaUse` — a
bare string return, printed as-is — to `fastEval` with `{ error }` and `errorOutput`
(`src/lib/cli-output.js`).

## `tokens add` Created Half a Token Before Failing (2026-09-05, panel feedback)

**Symptom:** `tokens add lab/bad "#zz" -c CLI-Lab-Test -t COLOR` printed a twelve-line Figma
validation dump and exit 0 — and the collection now held a `lab/bad` with no value; the
reporter's `CLI-Lab-Test (5)` was made of those.

**Cause:** value and type went to Figma unchecked; `createVariableCollection` and
`createVariable` succeed, `setValueForMode` throws.

**Fix:** `validateTokenInput(value, type)` before the eval — the colour rule from
`src/lib/color.js`, the four type names — so a bad input creates nothing; a Figma error that
still gets through shows its first line.

## `tokens components` Never Exited (2026-09-05, panel feedback)

**Symptom:** the summary printed after ~15 s, then the process stayed alive until killed (5:23,
2:32, 1:49 min in the reporter's runs; SIGTERM at 45 s in mine).

**Cause:** the nine frames were rendered through `getFigmaClient()` — a direct CDP websocket
that nothing closes. `extract` had met the same hang and carried a `process.exit(0)` for it.

**Fix:** `fastRender` (the daemon owns the render, as `cli-core.js` says above it); 0.9 s, exit 0.
The `--replace` count came back as 0 for the same family of reason: a bare last expression
the daemon eval does not return — `componentsCleanupCode` is a function with `return removed`.

## Malformed JSX Rendered an Empty Frame (2026-09-05, panel feedback)

**Symptom:** `render '<Frame name="X"><Text>x</Frame>'` printed `[render] Warning: Frame has
content but no elements were parsed.` then `✓ Rendered`, exit 0, an empty 100×100 frame.

**Cause:** `parseJSX` only warned when the frame's content parsed to zero elements.

**Fix:** it throws `Invalid JSX: content inside <Frame> parsed to no element (an unclosed
tag?) … Content: <Text>x`; `render` exits 1 and nothing reaches the canvas
(`tests/jsx-unclosed-tag.test.js`).
