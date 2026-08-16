# LEARNINGS

Project learnings, decisions and dead ends. Appended after a workload, only when something is worth remembering. Keeps `CLAUDE.md` short.

Per-bug detail with symptom/cause/fix: `.claude/bugs-and-fixes.md`. Why a behavior changed upstream: `CHANGELOG.md`.

## Figma Plugin API

- Fills and strokes are **immutable arrays** — clone, modify, reassign. In-place mutation is silently ignored.
- `setBoundVariableForPaint(paint, 'color', variable)` returns a *new* paint. Assigning it back to `fills` is required.
- `createComponentFromNode()` throws if the node already sits inside a Component, ComponentSet or Instance.
- `layoutWrap = 'WRAP'` works only on HORIZONTAL auto-layout; VERTICAL throws.
- An auto-layout child with `layoutAlign = 'STRETCH'` needs FIXED sizing on that axis — STRETCH + AUTO conflict.
- `layoutMode = 'NONE'` does not restore children's original positions. One-way trip.
- Component property names carry a `#uniqueId` suffix (`ButtonText#0:1`); never match on the bare name.
- `frame.isSlot = true` via `eval` does nothing — only `slot convert` produces a real slot.
- Load fonts with `figma.loadFontAsync` before setting `characters`.

## Process

- **Numbers beat screenshots for layout bugs.** The upstream parity harness (`tests/live/parity-harness.mjs`) found that 9 of 10 cases rendered differently between `render` and `render-batch` — invisible in a screenshot, obvious in a node-tree diff. Any "auto-layout behaves weirdly" report is a measurement task, not an eyeballing task.
- **A silent no-op is worse than an error.** `minW`/`maxW`/`minH`/`maxH` were documented and accepted but never emitted; the same for `stretch`. Nothing failed, the output was just wrong. When adding a JSX prop, add the assertion that it reaches the node.
- **Pure decision + unit test, I/O in the command module.** That convention is why 525 tests run without a Figma instance. New logic that branches on state belongs in `src/lib/`.

## Fork Decisions (clementcopper)

- **Migrated from v1.1.1 to upstream v2.1.2 on 2026-08-16** by branching from `upstream/main` (branch `v2`) instead of merging. The merge was not viable: upstream had split `src/index.js` from 8342 to 31 lines, so a merge would have meant hand-resolving the old monolith against 67 changed lines. Old state kept in `archive/draft-v1`.
- **Kept from the fork:** `bin/fig-start`, `bin/fig-status`, and the non-destructive `connect`. Dropped as redundant: the 60-minute daemon idle timeout (upstream had the identical value), the README workflow section, and the pre-2.x `CLAUDE.md`.
- **`docs/FIGMA-USAGE.md` is upstream's `CLAUDE.md`, moved byte-identical.** Rename detection then carries upstream edits into it on future merges. Editing it there would trade a short `CLAUDE.md` for a permanent conflict on every pull.

## Dead Ends

- **`figma-use` as the transport.** Broken on Node 20+, hardcoded port, failed on FigJam, and `render` delegating to it was one of three disagreeing layout implementations. Upstream dropped the dependency in 2.1.1; `figmaUse()` in `src/lib/cli-core.js` is now just a native shim that kept the name. Do not reintroduce the package.
- **`layoutGrow` for `grow={1}`.** Deprecated and unreliable; use `layoutSizingHorizontal/Vertical = 'FILL'` on the parent's flex axis.
- **Guessing which wrapper compiles for `eval`.** Three regexes looking for `return` missed common shapes. `src/lib/eval-wrap.js` now asks the engine (`new Function(src)`) instead of guessing.
