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
- `componentPropertyDefinitions` throws on a **variant** component — read it from the ComponentSet instead.
- `instance.setProperties({'Text#…': …})` only changes text whose node carries `componentPropertyReferences.characters`. Where a design system sets its texts as plain overrides, the property exists but does nothing — write `instance.children[…].characters` directly.

## `render` bugs from 2.1.2 — fixed here, [issue #42](https://github.com/silships/figma-cli/issues/42) / [upstream PR #43](https://github.com/silships/figma-cli/pull/43)

- **A `catch` that cleans up must see the variable it cleans.** `const frame` lived inside the `try`, `frame.remove()` in the `catch`: *every* render error became `ReferenceError: frame is not defined`, the `[Node: …]` wrapper one line below was unreachable, and cleanup never ran — so failed renders left orphan frames on the canvas. Fixed by hoisting `let frame` and guarding the removal. Cost: the error message lied about the cause for as long as the bug existed.
- **`w="fill"` / `h="fill"` broke in three places**, all masked by the above: root frame without `--parent` (nothing to fill — now a warning), root frame with `--parent` (FILL was set before `appendChild`, so it could never work — now after), and `<Rectangle>` / `<Ellipse>` / `<Image>` (the keyword reached `resize()` as the string `"fill"` — now handled like a Frame child). Logic lives in `src/lib/fill-sizing.js`.
- **Order matters in the generated template.** `appendChild` runs last on purpose (so an auto-layout parent measures real content), which makes every parent-dependent property — `layoutSizing*` above all — invalid anywhere earlier in the template.

## Text Styles (added 2026-08-17, [upstream PR #44](https://github.com/silships/figma-cli/pull/44))

- **Writing `fontSize` / `fontName` / `lineHeight` / `letterSpacing` onto a text node CLEARS its `textStyleId`.** Measured live: `before=set → afterFontSizeWrite=CLEARED`. There is no "override the style" like in the Figma UI — a plugin-side override detaches. `textAlignHorizontal` is the exception and stays bound. That killed the planned CSS-style precedence; conflicting props are now reported, not applied.
- **Remote (library) styles have no name lookup.** `getLocalTextStylesAsync()` returns local ones only; `importStyleByKeyAsync` needs a key nobody has. The only way to reach a library style by name is to harvest the `textStyleId`s already used in the document (`findAllWithCriteria({types:['TEXT']})` + `getStyleByIdAsync`).
- **Runtime rules stay testable via `.toString()`.** `src/lib/text-styles.js` is imported in Node for its unit tests and embedded into the generated code as source, so there is one copy of the matching rules instead of a testable one and a template-string one. Cost: no imports, no closures, plain function declarations in that file.

## Claude Panel (`app/`, Electron)

- **`ELECTRON_RUN_AS_NODE=1` wird vererbt.** Jedes Terminal, das eine Electron-App gestartet hat (VS Code, Claude Code), gibt die Variable weiter — die Electron-Binary läuft dann als reines Node, und `require('electron')` scheitert mit „Cannot find module 'electron'". Sieht aus wie eine kaputte Installation, ist eine Umgebungsvariable. Deshalb wird sie in `run-electron.mjs` **und** in der PTY-Umgebung gelöscht.
- **`"type": "module"` frisst jede kopierte CommonJS-Datei.** Zweimal dieselbe Ursache, zweimal ein anderes Symptom: das Preload lud nicht (`ERR_REQUIRE_ESM`, Fenster blieb leer), und der Statusline-Producer starb mit `ReferenceError: require is not defined` — **lautlos**, weil Claude Code nie zeigt, was sein `statusLine`-Kommando auf stderr schreibt. Beim Portieren aus einem CommonJS-Paket: jede übernommene `.js`-Datei, die `require` benutzt, auf `.cjs` umbenennen.
- **`claude --settings` nimmt Inline-JSON.** Der Fehler „Settings file not found: {…" heißt nur, dass der String kein gültiges JSON war — Claude probiert erst Datei, dann JSON. Beinahe hätte ich daraus geschlossen, der ganze Weg funktioniere nicht.
- **Preload muss CommonJS sein.** In einem Paket mit `"type": "module"` lädt Electron `preload.js` nicht (`ERR_REQUIRE_ESM`) — Endung `.cjs`. Der Fehler steht nur in der Renderer-Konsole, das Fenster bleibt sonst wortlos leer; `webContents.on('console-message')` ins Log zu hängen war der Schritt, der es sichtbar machte.
- **Named Imports aus `electron` überleben das CJS-Bundling nicht.** esbuild wickelt `import { app } from 'electron'` in `__toESM(require(...))`, und `app` ist danach `undefined`. Default-Import plus Destrukturierung funktioniert.
- **Claudes Statuszeile kommt nicht aus dem Terminalstrom.** Modell, Effort, Kontext und Rate-Limits übergibt Claude Code seinem `statusLine`-Kommando als JSON auf stdin. Der Panel-Weg braucht dafür **keinen** Eingriff in `~/.claude/settings.json`: `claude --settings '{"statusLine":…}'` gilt nur für diesen Prozess, und der eigene Befehl des Nutzers wird per `CLAUDE_PANEL_DELEGATE` weiter aufgerufen.

## Process

- **Numbers beat screenshots for layout bugs.** The upstream parity harness (`tests/live/parity-harness.mjs`) found that 9 of 10 cases rendered differently between `render` and `render-batch` — invisible in a screenshot, obvious in a node-tree diff. Any "auto-layout behaves weirdly" report is a measurement task, not an eyeballing task.
- **A silent no-op is worse than an error.** `minW`/`maxW`/`minH`/`maxH` were documented and accepted but never emitted; the same for `stretch`. Nothing failed, the output was just wrong. When adding a JSX prop, add the assertion that it reaches the node.
- **Pure decision + unit test, I/O in the command module.** That convention is why 535 tests run without a Figma instance. New logic that branches on state belongs in `src/lib/`.
- **Reproduce before recording a bug.** The `render` note above originally blamed `<Rectangle>`. A five-minute matrix — Rectangle with hex / `var:` / no fill / `w="fill"`, then the same on Frame and Text — cleared the element, pinned `w="fill"` as the trigger, and led to the real cause one layer down (the `catch` block). A symptom written down as a cause misleads every later session.

## Fork Decisions (clementcopper)

- **Migrated from v1.1.1 to upstream v2.1.2 on 2026-08-16** by branching from `upstream/main` (branch `v2`) instead of merging. The merge was not viable: upstream had split `src/index.js` from 8342 to 31 lines, so a merge would have meant hand-resolving the old monolith against 67 changed lines. Old state kept in `archive/draft-v1`.
- **Kept from the fork:** `bin/fig-start`, `bin/fig-status`, and the non-destructive `connect`. Dropped as redundant: the 60-minute daemon idle timeout (upstream had the identical value), the README workflow section, and the pre-2.x `CLAUDE.md`.
- **`docs/FIGMA-USAGE.md` is upstream's `CLAUDE.md`, moved byte-identical.** Rename detection then carries upstream edits into it on future merges. Editing it there would trade a short `CLAUDE.md` for a permanent conflict on every pull.

## Dead Ends

- **`figma-use` as the transport.** Broken on Node 20+, hardcoded port, failed on FigJam, and `render` delegating to it was one of three disagreeing layout implementations. Upstream dropped the dependency in 2.1.1; `figmaUse()` in `src/lib/cli-core.js` is now just a native shim that kept the name. Do not reintroduce the package.
- **`layoutGrow` for `grow={1}`.** Deprecated and unreliable; use `layoutSizingHorizontal/Vertical = 'FILL'` on the parent's flex axis.
- **Guessing which wrapper compiles for `eval`.** Three regexes looking for `return` missed common shapes. `src/lib/eval-wrap.js` now asks the engine (`new Function(src)`) instead of guessing.
