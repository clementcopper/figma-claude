# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm test                                # all tests (node --test tests/*.test.js)
node --test tests/figma-client.test.js  # single test file
node src/index.js <command>             # run the CLI from source
bash bin/fig-status                     # Figma / CDP / daemon / file status
node src/index.js daemon restart        # fixes most connection failures
```

No build step, no linter. Pure ESM, Node ≥18. Two binaries: `figma-ds-cli` (`src/index.js`) and `fig-start` (`bin/fig-start`, bash launcher).

---

## Architecture

The CLI drives Figma Desktop by executing JavaScript inside Figma's renderer — no Figma API key, no cloud round-trip. Everything is the Figma Plugin API running against the global `figma` object.

### Transport chain

```
CLI (src/index.js)
  → HTTP localhost:3456  (src/daemon.js, persistent)
    → CDP WebSocket localhost:9222  (src/figma-client.js)
      → Runtime.evaluate inside Figma Desktop (Electron)
```

1. **`src/figma-patch.js`** — patches Figma's `app.asar` to re-enable `--remote-debugging-port` (newer Figma builds strip it). `patchFigma()` / `unpatchFigma()` / `isPatched()`. Port is hardcoded 9222.
2. **`src/figma-client.js`** — `FigmaClient` class: CDP WebSocket, handles Figma v39+ sandboxed execution contexts, plus every high-level operation (`render`, `getVariables`, `toComponent`, library import, export…).
3. **`src/daemon.js`** — HTTP server that keeps the CDP connection warm across CLI invocations (~10x faster than reconnecting each time). Hot-reloads `figma-client.js` via `getFigmaClient()`, so client edits take effect after `daemon restart` without restarting Figma.
4. **`src/platform.js`** — all macOS/Windows/Linux branching (kill port, asar path, launch Figma, version detect). `figma-patch.js` delegates its path helpers here — **add new platform branching only in `platform.js`**.

### Connection modes

- **Yolo (default)** — patch once, connect over CDP. `MODE = 'cdp'`.
- **Safe (`--safe`)** — Figma plugin in `plugin/` talks WebSocket to the daemon; no `app.asar` modification. `MODE = 'plugin'`. Known limitation: `render-batch` does not render text properly here — use `eval` with the native Figma API instead.

`daemon.js` picks the path per request (`evalViaCdp` vs `evalViaPlugin`) and retries once on plugin reconnect, so most commands are mode-agnostic.

### Daemon security

Binds localhost only, validates the `Host` header (anti-DNS-rebinding), requires `X-Daemon-Token` (stored at `~/.figma-ds-cli/.daemon-token`), sends no CORS headers, auto-shuts down when idle (default 10 min).

### Render pipeline — two separate code paths

Both take JSX-like markup and emit a string of Figma Plugin API code that runs inside Figma. They are **not** shared implementations; a fix in one usually needs porting to the other.

| Path | Entry | Traits |
|---|---|---|
| Single `render` | `parseJSX()` (`figma-client.js:540`) → `generateCode()` (`:834`) | full `var:` binding support; children sized via `layoutSizingHorizontal/Vertical` |
| `render-batch` | `parseJSXBatch()` (`figma-client.js:291`), dispatched at `daemon.js:423` | one eval for all frames; no `var:` support; older `primaryAxisSizingMode`/`counterAxisSizingMode` sizing |

Icons: SVGs are prefetched Node-side from the Iconify API (`prefetchIconSvgs()`), embedded in the generated code, and created with `figma.createNodeFromSvg()` — real vectors, not placeholders.

### Key files

| File | Role |
|---|---|
| `src/index.js` (~8.3k lines) | every CLI command (Commander.js), grouped by subcommand |
| `src/figma-client.js` (~4.2k lines) | CDP client + JSX parser + code generator + Figma operations |
| `src/daemon.js` | persistent server, mode switching, request auth |
| `src/figma-patch.js` / `src/platform.js` | asar patching / OS-specific behavior |
| `src/shadcn.js` | shadcn/ui component templates |
| `src/figjam-client.js` | FigJam-specific client (bypasses `figma-use`, which breaks on FigJam) |
| `src/blocks/` | pre-built layouts (`dashboard-01.js`), registry in `index.js` |
| `plugin/` | Safe Mode Figma plugin (`code.js`, `ui.html`, `manifest.json`) |
| `bin/fig-start`, `bin/fig-status` | bash entry points; config at `~/.figma-cli/config.json` |

`figma-use` is legacy: only a fallback path in `src/index.js:212` warns it is broken on Node 20+. Do not build new features on it.

---

## Gotchas That Cost Real Debugging Time

- **shadcn collections are named `shadcn/primitives` and `shadcn/semantic`** — match with `c.name.startsWith('shadcn')`, never `=== 'shadcn'`. A `=== ` match silently falls back to gray `rgb(0.5,0.5,0.5)` fills.
- **`layoutSizingHorizontal = 'FILL'` must be set AFTER `appendChild()`** — before it throws "FILL can only be set on children of auto-layout frames".
- **Root frame vs children use different sizing APIs.** Root: `primaryAxisSizingMode`/`counterAxisSizingMode`. Children: `layoutSizingHorizontal`/`layoutSizingVertical`. Mixing them produces sizing conflicts.
- **No explicit `h` must mean HUG, not a default height** — defaulting to a fixed height clips content. Which axis is "primary" depends on layout direction (VERTICAL: primary = height).
- **JSX parser order matters** — parse open/close `<Frame>` pairs first, then self-closing tags outside the consumed ranges, and skip `match[0].endsWith('/>')` in the open-tag regex. Otherwise self-closing frames become stray siblings.
- **`frame.isSlot = true` does nothing via `eval`.** Slots must go through `node src/index.js slot convert "<id>" --name "..."`.
- **Fonts must be loaded (`figma.loadFontAsync`) before setting `characters`.**

More detail with symptom/cause/fix per bug: `.claude/bugs-and-fixes.md`. Parser and Plugin API notes: `.claude/MEMORY.md`, `.claude/figma-plugin-api.md`.

---

## Conventions

- **Creating nodes: use `render` / `render-batch`, not `eval`.** `render` has smart positioning; `eval`-created nodes stack at (0,0). Exception: complex components in Safe Mode (see `docs/FIGMA-USAGE.md`).
- **Never delete existing nodes on a user's canvas** — check the rightmost edge and place new work after it.
- **After any visual creation, run `node src/index.js verify [nodeId]`** — returns a base64 screenshot for self-checking. Internal only, not user-facing output.
- **Onboarding users: never print terminal commands.** Run them silently, report in plain language.
- Long-lived learnings go in `LEARNINGS.md` (project) — not into this file, which stays under 200 lines.

---

## Further Reading

| Doc | Contents |
|---|---|
| `docs/FIGMA-USAGE.md` | **The design-assistant guide**: JSX syntax, `var:` binding, tokens, blocks, slots, layout patterns, common mistakes. Read this before generating anything in Figma. |
| `REFERENCE.md` | full command reference |
| `docs/COMMANDS.md`, `docs/TECHNIQUES.md`, `docs/FIGJAM.md` | command details, techniques, FigJam |
| `docs/ARCHITECTURE.md` | connection-flow overview |
| `README.md` | user-facing feature tour |
