# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Building something in Figma? Pull the topic you need, don't read the whole guide:**

```bash
node src/index.js docs                 # list the 19 topics with their token cost
node src/index.js docs jsx-syntax      # ~930 tok instead of the guide's ~10,200
node src/index.js docs critical-pitfalls
```

`docs/FIGMA-USAGE.md` holds all of it — Quick Reference, JSX rules, tokens, slots, motion, pitfalls — but reading it whole costs ~10k tokens before any work starts. `docs <topic>` prints one section. This file is about working on the CLI itself.

## Development Commands

```bash
npm install                             # first run; deps changed in 2.x (jpeg-js, pngjs, yaml)
npm test                                # full suite — 525 tests, no Figma needed
node --test tests/connect-plan.test.js  # single test file
npm run test:parity                     # LIVE: renders through both paths, diffs node trees
npm run examples                        # LIVE: auto-layout gallery that verifies itself

# what CI checks, reproduced locally (Node 18/20/22 in .github/workflows/test.yml)
for f in src/index.js src/lib/*.js src/commands/*.js src/daemon.js src/figma-client.js; do node --check "$f"; done
```

`test:parity` and `examples` drive a real Figma Desktop and change the open file — never run them to "check something quickly". No build step, no linter. Pure ESM, Node ≥18.

---

## Architecture

The CLI drives Figma Desktop by executing JavaScript inside Figma's renderer — no API key, no cloud roundtrip. Everything is the Figma Plugin API against the global `figma` object.

### Transport chain

```
CLI (src/index.js → src/commands/*.js)
  → HTTP localhost:3456   (src/daemon.js, persistent)
    → CDP WebSocket :9222 (src/figma-client.js)
      → Runtime.evaluate inside Figma Desktop
```

### Entry point and lazy loading

`src/index.js` is 31 lines. It scans argv for the first token that names a command, looks it up in `src/lib/command-map.js`, and imports only that command module — startup drops from ~110ms to ~67ms. Anything unrecognised (`--help`, unknown command, no args) falls back to loading all 25 modules so help and suggestions stay complete.

**Adding or renaming a command means updating `src/lib/command-map.js`.** `tests/lazy-command-map.test.js` regenerates the map from the real Commander tree and fails if an entry is missing or a cross-module forward is undeclared, so this cannot silently drift.

### Module layout

| Path | Role |
|---|---|
| `src/lib/cli-core.js` | shared core: the Commander `program`, daemon plumbing, eval helpers, config. Every command module imports from here |
| `src/commands/*.js` (25) | one module per command group; each registers its commands as an import side effect |
| `src/lib/*.js` | pure, testable logic pulled out of the commands (`design-spec`, `variant-plan`, `eval-wrap`, `connect-plan`, `roundtrip`, …) |
| `src/figma-client.js` | CDP client + JSX parser + Plugin API code generator |
| `src/daemon.js` | persistent server, mode switching, request auth |
| `src/figma-patch.js` / `src/platform.js` | `app.asar` patching / macOS-Windows-Linux behavior |
| `src/blocks/`, `src/shadcn.js` | pre-built layouts and component templates |
| `plugin/` | Safe Mode Figma plugin |
| `skills/figma-cli/`, `.claude-plugin/` | the repo installable as a Claude Code plugin |
| `bin/` | **fork-local** launcher scripts, see below |

### The testing convention worth copying

Logic that decides something goes into `src/lib/` as a pure function with a unit test; the command module keeps only the I/O. `browserDebugArgs` (`src/platform.js` + `tests/browser-mode.test.js`) and `resolveConnectAction` (`src/lib/connect-plan.js` + `tests/connect-plan.test.js`) are the pattern. That is why 525 tests run without a Figma instance.

### Connection modes

- **Yolo (default)** — patches `app.asar` once to re-enable `--remote-debugging-port`, then CDP. Needs macOS "App Management" permission.
- **Browser (`--browser`)** — runs Figma in a Chromium browser with its own profile. Same speed, the desktop app is never modified.
- **Safe (`--safe`)** — the plugin in `plugin/` talks WebSocket to the daemon. No patching. `render`/`render-batch` including text behave as in Yolo Mode (the old "no text in Safe Mode" limitation is gone).

`src/daemon.js` picks `evalViaCdp` vs `evalViaPlugin` per request and retries once on plugin reconnect, so commands are mode-agnostic.

### The two render paths

`render` and `render-batch` still run through different generators in `src/figma-client.js` (`generateCode` vs `generateBatchCode`). They are kept honest by `tests/live/parity-harness.mjs`, which renders the same JSX through both and diffs the node trees numerically — identical JSX must produce identical layout. **Touching one generator means running `npm run test:parity`** against a live Figma; when the harness was first written, 9 of 10 cases differed.

### Daemon

Binds localhost only, validates the `Host` header (anti-DNS-rebinding), requires `X-Daemon-Token` (`~/.figma-ds-cli/.daemon-token`), no CORS, idle auto-shutdown after 60 min.

It **hot-reloads `figma-client.js`** by copying it to a temp module when its mtime changes — edits to the client take effect on the next command with no restart. Editing `daemon.js` itself does need `daemon restart`.

### CDP port

`getCdpPort()` (`src/figma-patch.js`) reads `FIGMA_PORT`, and `--port` sets it globally. Don't hardcode 9222 in new code; `bin/` reads `${FIGMA_PORT:-9222}`.

---

## Fork-Specific (clementcopper/figma-cli)

`upstream` = `silships/figma-cli`, `origin` = this fork. Everything above is upstream; these three are ours and have to survive future upstream pulls:

| What | Where |
|---|---|
| `fig-start` — connect + pick among the open Figma files | `bin/fig-start` |
| `fig-status` — Figma / CDP / daemon / active file at a glance | `bin/fig-status` |
| Non-destructive `connect` — never quits a Figma that is already debuggable | `src/lib/connect-plan.js`, used in `src/commands/setup.js` |

The `connect` fix is written to be upstreamable (pure function + unit test, no fork specifics). If it lands upstream, drop it here on the next pull.

`docs/FIGMA-USAGE.md` is upstream's `CLAUDE.md`, moved unchanged so this file can stay short. **Keep its content byte-identical to upstream** — Git's rename detection then applies upstream's edits to it automatically instead of conflicting. Fork notes belong in this file, not in there.

### Pulling from upstream

```bash
git fetch upstream && git merge upstream/main
```

Expect conflicts only in `CLAUDE.md` (ours) and possibly `package.json` (`bin`/`files` entries for `bin/`).

---

## Repo Gotchas

- **`figma-use` is gone** (dropped in 2.1.1 so installs stay audit-clean). Some helper names still mention it; it is not a dependency. Don't reintroduce it.
- **Platform code:** helpers belong in `src/platform.js`. `src/commands/setup.js` and `src/figma-patch.js` branch on `process.platform` too, but only for user-facing permission messages and asar paths — not a licence to add a fourth place.
- **`figma.loadFontAsync` before setting `characters`**, always.
- **`frame.isSlot = true` does nothing via `eval`** — slots need `slot convert`.
- **Never delete existing nodes** on a user's canvas; place new work past the rightmost edge.
- Verify visual creations with `figma-cli verify [nodeId]` (or `render --verify` for one roundtrip). Internal check, not user-facing output.

---

## Further Reading

| Doc | Contents |
|---|---|
| `docs/FIGMA-USAGE.md` | usage guide: Quick Reference, JSX syntax, key rules, critical pitfalls. Read it section-wise with `docs <topic>` |
| `REFERENCE.md` | full command reference |
| `CHANGELOG.md` | why behavior changed — the auto-layout section explains most legacy weirdness |
| `.claude/MEMORY.md`, `.claude/bugs-and-fixes.md`, `.claude/figma-plugin-api.md` | parser internals, past bugs with root causes, Plugin API notes |
| `docs/ARCHITECTURE.md`, `docs/TECHNIQUES.md`, `docs/FIGJAM.md` | connection flow, techniques, FigJam |
| `LEARNINGS.md` | project learnings and dead ends |
