---
paths:
  - "src/**"
  - "tests/**"
  - "plugin/**"
---

# CLI, Figma Plugin API, generators

Distilled from `LEARNINGS.md` § Figma Plugin API, § `render` bugs, § Text Styles, the code-side bullets of § Process and § Dead Ends. Per-bug detail: `.claude/bugs-and-fixes.md`. `loadFontAsync`, `isSlot`, `figma-use`, the parity harness and the pure-decision convention are already in `CLAUDE.md`.

## Plugin API

- **Fills and strokes are immutable arrays: clone, modify, reassign.** In-place mutation is silently ignored; `setBoundVariableForPaint` returns a *new* paint that must be assigned back.
- **`createComponentFromNode()` throws inside a Component, ComponentSet or Instance.**
- **`layoutWrap = 'WRAP'` works only on HORIZONTAL auto-layout;** `layoutAlign = 'STRETCH'` needs FIXED sizing on that axis; `layoutMode = 'NONE'` is a one-way trip, children's positions are not restored.
- **Component property names carry a `#uniqueId` suffix;** never match on the bare name. `componentPropertyDefinitions` throws on a variant, read it from the ComponentSet.
- **`instance.setProperties({'Text#…'})` changes only text with `componentPropertyReferences.characters`.** Where a design system uses plain overrides, write `instance.children[…].characters` directly.
- **`arcData` ends are always flat.** Round caps need a real vector path via `figma.createNodeFromSvg` with `stroke-linecap="round"`; the track colour still binds afterwards.
- **Writing `fontSize`/`fontName`/`lineHeight`/`letterSpacing` clears `textStyleId`** (measured). Only `textAlignHorizontal` stays bound; conflicting props are reported, not applied.
- **Remote library styles have no name lookup.** Harvest the `textStyleId`s already used in the document (`findAllWithCriteria` + `getStyleByIdAsync`); `getLocalTextStylesAsync` is local only.
- **`loadAllPagesAsync()` is not free** (outlasts the 60 s sync budget on 5235 instances); load pages only after a lookup has missed.
- **Don't retry: `layoutGrow` for `grow={1}`** (use `layoutSizingHorizontal/Vertical = 'FILL'`), **guessing the `eval` wrapper by regex** (`src/lib/eval-wrap.js` asks `new Function(src)`).

## Generators and runtime rules

- **A `catch` that cleans up must see the variable it cleans.** `const frame` inside the `try` turned every render error into `ReferenceError: frame is not defined` and left orphan frames; hoist `let frame`, guard the removal.
- **`w="fill"`/`h="fill"` logic lives in `src/lib/fill-sizing.js`;** FILL on a root frame needs `--parent` and must be set after `appendChild`; `<Rectangle>`/`<Ellipse>`/`<Image>` take the keyword like a Frame child.
- **`appendChild` runs last in the generated template on purpose,** so every parent-dependent property (`layoutSizing*`) is invalid anywhere earlier.
- **Runtime rules stay testable via `.toString()`.** `src/lib/text-styles.js` is unit-tested in Node and embedded as source: no imports, no closures, plain function declarations in that file.
- **Never flatten generated code onto one line.** A `//` comment then swallows the rest; the daemon's code error surfaces as `spawnSync /bin/sh ETIMEDOUT` after 60 s and looks like a broken connection. `figmaUse` parses with the `s` flag.
- **Time the cheap case before declaring a transport dead.** The sync eval path answers in 17–273 ms; the 60 s silence was my own multi-line code.
- **Two commands that share a decision get one function, not two copies.** `eval` learned to name an empty result, `run` did not, and REFERENCE.md claimed both; the friction came back six weeks later.
- **A silent no-op is worse than an error.** `minW`/`maxW`/`minH`/`maxH`/`stretch` were documented and never emitted; every new JSX prop gets an assertion that it reaches the node.
- **A pure decision function is only as good as the probe feeding it.** `resolveConnectAction` was correct with four tests; the bug was in the boolean handed to it (`pgrep -f` vs `-x`). Instrument inputs first.
- **A process name is not a substring: `pgrep -x Figma`.** `-f` matched `figma_agent` and `FigmaClaude`, so `connect` demanded "Quit Figma" forever. Five places ask whether Figma runs; grep for the outlier.
- **The feedback hook decides in `src/lib/feedback-trigger.js`, with tests.** Matching `figma-cli`/`⚠` against the whole payload fired on `tail LEARNINGS.md`; the command belongs in a parser, failure markers belong to the response only, and the once-per-session latch is spent on a hit, not a firing.
- **A test that litters is a bug in the test.** `mkdtempSync` needs its `t.after(() => rmSync(...))` in the same breath; 45 temp dirs in `$TMPDIR` from one day.
- **`DESIGN.md` must not print an estimate like a measurement.** The GCD-guessed base unit under "### Do" made a foreign instance build against a 2 px grid; mark estimated sections, use the indicative, print real binding names (`color/brand-500`, not `accent-3`). `--pages` filters pages, not metrics.
- **Claude Code reads `CLAUDE.md` and `.claude/rules/*.md`, not `AGENTS.md`.** `init-agent` writes `.claude/rules/figma-cli.md`; the AGENTS.md route was inert until 2026-08-19.
- **`FIGMACLAUDE=1` is the marker the CLI can branch on** (`src/lib/connection-help.js`): inside the panel, never advise `figma-cli connect`, connecting is a button and Daniel's job.
- **Numeric JSX props are numbers when they leave `parseProps`** (`src/lib/jsx-numeric.js`); never splice a prop string into generated code. Every value inside plugin code goes through `JSON.stringify` — `tests/plugin-code-quoting.test.js` fails on the next raw one.
- **A failure line sets the exit code within eight lines** (`tests/exit-codes.test.js`; a red ✗ in single quotes or a template literal, a `{ ok: false }` JSON line, a `spinner.fail`); `checkConnection` is awaited or the sync form is used (`tests/check-connection-await.test.js`).
- **Never delete the user's nodes or variables unasked:** `--replace` / `--yes`; `var delete-all` previews first.
- **The daemon has an integration test without Figma** (`tests/daemon-live.test.js`, Plugin Mode, temp HOME); extend it before touching `daemon.js`. Editing daemon.js needs `daemon restart`; figma-client.js hot-reloads.
- **A module that adds subcommands to another module's group must be in `command-map.js`** for that group; the map test checks subcommand contributors too.
- **`fetch failed` from the daemon does not mean Figma is gone.** A daemon holds one CDP link fixed at startup and outlives it; say the request did not get through, name `status` / `daemon restart`.
