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
- **`arcData` ends are always flat.** An arc/ring made from an EllipseNode is a filled wedge, so `strokeCap` has nothing to act on and no prop gives it round ends. Round caps need a real vector path: `figma.createNodeFromSvg` with `stroke-linecap="round"`. The track colour of that SVG ring still binds afterwards with `setBoundVariableForPaint`.
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

- **`FIGMACLAUDE=1` is the marker the CLI can read.** The panel exports it into every session (`swift-host/…/PanelConfig.swift`), so any CLI message that would otherwise name a command a panel session must not run can branch on it — see `src/lib/connection-help.js`. Advice that names `figma-cli connect` is wrong inside the panel, where connecting is a button and explicitly Daniel's job.
- **`fetch failed` from the daemon does not mean Figma is gone.** Seen while fixing the entry above: the daemon answered `/health` with `cdp:false` while a fresh `FigmaClient` connected to the same Figma in the same second. A daemon holds ONE CDP link, fixed at startup, and outlives it. `daemon restart` fixed it. Never phrase that error as "Figma is not connected" — say the request did not get through and name `status` / `daemon restart`.
- **`ELECTRON_RUN_AS_NODE=1` wird vererbt.** Jedes Terminal, das eine Electron-App gestartet hat (VS Code, Claude Code), gibt die Variable weiter — die Electron-Binary läuft dann als reines Node, und `require('electron')` scheitert mit „Cannot find module 'electron'". Sieht aus wie eine kaputte Installation, ist eine Umgebungsvariable. Deshalb wird sie in `run-electron.mjs` **und** in der PTY-Umgebung gelöscht.
- **`"type": "module"` frisst jede kopierte CommonJS-Datei.** Zweimal dieselbe Ursache, zweimal ein anderes Symptom: das Preload lud nicht (`ERR_REQUIRE_ESM`, Fenster blieb leer), und der Statusline-Producer starb mit `ReferenceError: require is not defined` — **lautlos**, weil Claude Code nie zeigt, was sein `statusLine`-Kommando auf stderr schreibt. Beim Portieren aus einem CommonJS-Paket: jede übernommene `.js`-Datei, die `require` benutzt, auf `.cjs` umbenennen.
- **`claude --settings` nimmt Inline-JSON.** Der Fehler „Settings file not found: {…" heißt nur, dass der String kein gültiges JSON war — Claude probiert erst Datei, dann JSON. Beinahe hätte ich daraus geschlossen, der ganze Weg funktioniere nicht.
- **Preload muss CommonJS sein.** In einem Paket mit `"type": "module"` lädt Electron `preload.js` nicht (`ERR_REQUIRE_ESM`) — Endung `.cjs`. Der Fehler steht nur in der Renderer-Konsole, das Fenster bleibt sonst wortlos leer; `webContents.on('console-message')` ins Log zu hängen war der Schritt, der es sichtbar machte.
- **Named Imports aus `electron` überleben das CJS-Bundling nicht.** esbuild wickelt `import { app } from 'electron'` in `__toESM(require(...))`, und `app` ist danach `undefined`. Default-Import plus Destrukturierung funktioniert.
- **`open App.app` aus dem Terminal vererbt dessen Umgebung.** Aus einer Shell mit `ELECTRON_RUN_AS_NODE` startet die gepackte App als reines Node und beendet sich wortlos — kein Fenster, kein Crash-Report, kein Log. Aus dem Finder läuft dieselbe App. Dritter Auftritt derselben Variable.
- **macOS rastert SVG selbst:** `qlmanage -t -s 1024 -o out datei.svg` — reicht für Icons, spart eine Bildbibliothek in der Toolchain. `iconutil -c icns` macht daraus das Bundle-Icon, mit eigener, vereinfachter Zeichnung für 16/32 px.
- **PATH ist nicht gleich PATH.** Aus dem Dock gestartet erbt eine App launchds PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) — ohne npm, ohne Homebrew, ohne `claude`. Aus dem Terminal gestartet erbt sie dessen PATH. Dieselbe App verhält sich dadurch je nach Startweg anders; die Login-Shell einmal fragen (`$SHELL -l -c 'printf %s "$PATH"'`) und den Wert weiterreichen.
- **Ein Shell-Alias existiert in keinem PTY.** `fig-start` ist ein Alias, kein Programm; und `figma-cli` liegt auf dieser Maschine gar nicht auf PATH (das Repo ist ein Checkout). Befehle, die für Daniel oder für die Eingabezeile geschrieben werden, brauchen `node ~/figma-cli/src/index.js` oder eine echte Auflösung.
- **In Claude Code ist eine nackte Zeile ein Prompt.** Ein Befehl, der in die Eingabe geschrieben wird, braucht `!` davor, sonst arbeitet Claude den Satz ab. Gilt nur für Claude Code — `gemini`, `aider` oder eine Shell nähmen das `!` wörtlich.
- **`zsh -l -c` sieht die `.zshrc` nicht.** Login ≠ interaktiv: zsh liest `.zshenv` und `.zprofile` für Login-Shells, `.zshrc` nur interaktiv — und dort schreiben Installer ihre PATH-Zeile hin (Claude Code: `export PATH="$HOME/.local/bin:$PATH"`). Die aus dem Dock gestartete App fragte mit `-l -c` und bekam einen PATH ohne `claude`; jeder Tab starb mit `[Process exited with code 1]` und ohne Ausgabe. Jetzt `-lic` plus Marker in der Ausgabe, weil eine interaktive Shell auch Banner druckt.
- **Ein fehlendes Kommando sieht aus wie ein Absturz.** node-pty meldet „nicht auf PATH" nicht — der Hilfsprozess beendet sich mit 1, schweigend. Vor dem Spawn nachschlagen und den Namen nennen, sonst sucht man an PATH, Claude und Bundle vorbei.
- **`grep -c ".local/bin"` ist kein Test.** Der unescapte Punkt passt auf `/usr/local/bin`; ich hatte damit „PATH ist in Ordnung" gemeldet, während genau dieser Eintrag fehlte. Bei Pfadprüfungen exakt vergleichen (`tr ':' '\n'` plus `grep -Fx`).
- **Ein `.app`-Bundle nicht ersetzen, solange es läuft.** `install:app` löschte `/Applications/FigmaClaude.app` ungefragt. Der Installer beendet die App jetzt zuerst — unabhängig davon, dass die eigentliche Ursache des Exit-1-Fehlers der PATH war.
- **Ein Werkzeug, das eine Schätzung wie eine Messung ausgibt, ist schlimmer als eines, das schweigt.** `DESIGN.md` schrieb die per GCD geratene Base Unit im Imperativ unter „### Do" — eine fremde Instanz baute daraufhin gegen ein 2px-Raster, das die Datei nie hatte. Geschätzte Abschnitte kennzeichnen und im Indikativ formulieren; wo eine Bindung existiert, deren Namen ausgeben statt eines erfundenen (`accent-3` war `color/brand-500`).
- **`--pages` filtert Seiten, nicht Kennzahlen.** Der Filter senkte die Fontliste von acht auf vier, an der Base Unit änderte er nichts — ein einziger ungerader Abstand im gefilterten Bestand genügt. Ich hatte das Gegenteil vorhergesagt und musste widerlegt werden.
- **Inline schlägt Stylesheet — auch das Stylesheet, das man gerade nachgezogen hat.** `claude-terminal-panel` hat den Terminal-Abstand über `.terminal-wrapper { display:flex; justify-content:center }` gelöst, aber `media/main.ts:1155` schreibt bei jeder Tab-Aktivierung `element.style.display = 'block'`. Gemessen im laufenden Fenster: 0 px über und 7,5 px unter der letzten Zeile statt 3,75/3,75. Ein `!important`-Override hilft nur mit `:not([style*='display: none'])`, sonst werden alle inaktiven Terminals sichtbar. Die saubere Lösung liegt in der Extension: `''` statt `'block'` zuweisen, dann gewinnt das Stylesheet von allein.
- **Claude Code liest `AGENTS.md` nicht.** Nur `CLAUDE.md` und `.claude/rules/*.md`; die Doku nennt als Brücke einen `@AGENTS.md`-Import. `init-agent` schrieb bis 19.08.2026 `AGENTS.md` mit der Begründung „Claude Code, Cursor, Codex all read it" — der Panel-Button war damit wirkungslos. `.claude/rules/figma-cli.md` ist der Weg, der zusätzlich keine fremde `CLAUDE.md` anfassen muss.
- **Claudes Statuszeile kommt nicht aus dem Terminalstrom.** Modell, Effort, Kontext und Rate-Limits übergibt Claude Code seinem `statusLine`-Kommando als JSON auf stdin. Der Panel-Weg braucht dafür **keinen** Eingriff in `~/.claude/settings.json`: `claude --settings '{"statusLine":…}'` gilt nur für diesen Prozess, und der eigene Befehl des Nutzers wird per `CLAUDE_PANEL_DELEGATE` weiter aufgerufen.

- **Ein Prozessname ist kein Substring.** `pgrep -f Figma` traf `figma_agent` (Figmas Updater, läuft bei geschlossenem Figma) und seit der Installation auch `FigmaClaude` samt drei Helfern. `connect` verlangte damit endlos „Quit Figma (Cmd+Q)", weil die Treffer nie Figma waren. Namen exakt vergleichen: `pgrep -x`. Die eigene App heißt absichtlich FigmaClaude — jede künftige Prozesssuche nach „Figma" trifft sie mit.
- **Der Panel findet die CLI nur über drei Wege, und alle drei können leer sein.** PATH (kein globales `npm i -g`), `repoPath` in `~/.figma-ds-cli/config.json` (schreibt nur `bin/fig-start`, hier nie gelaufen) und das Elternverzeichnis des Bundles (bei einer Installation in `/Applications` nie das Repo). Bleibt `figmaCli` in `panel.json` — der Wert darf ein Checkout-Pfad sein, der Resolver hängt `src/index.js` an.
- **Der aufgelöste CLI-Pfad wird pro Prozess gecacht** (`cli()` in `app/src/main.ts`). Eine Änderung an `panel.json` wirkt erst nach einem Neustart der App, nicht beim nächsten Klick.
- **electron-builder benennt das Ausgabeverzeichnis nach der Architektur** — `release/mac` auf x64, `release/mac-arm64` auf Apple Silicon. `install:app` suchte hart in `release/mac` und meldete „Nothing built" Sekunden nach einem erfolgreichen Build.

## Process

- **Ein Name an vier Stellen ist ein stiller Ausfall, der auf seinen Anlass wartet.** Der Ordner für die Panel-Dokumente hieß im `pre-clear`-Skill `Figma Claude/`, in dessen Schritt 3b `FigmaClaude/`, im SessionStart-Hook `FigmaClaude/` und im Swift-Host `FigmaClaude` — letzteres als Konstante, die **nirgends benutzt** wurde. Auf der Platte lag die Variante mit Leerzeichen. Ein Panel-Handoff wäre also geschrieben und nie gelesen worden; unbemerkt blieb es nur, weil überhaupt erst ein Handoff existierte und der aus einem Terminal stammte. Wo zwei Enden denselben Pfad bilden müssen, gehört ein Test dazwischen, der beide Zeichenketten vergleicht — nichts verglich sie, und genau deshalb liefen sie auseinander.

- **Eine gemeldete Zahl beweist nicht, welcher Befehl sie erzeugt hat.** Ein `wish` beschrieb `render --verify` als fest bei 0.5 und belegte es mit einer gemessenen Bildgröße — die Zahl stammte aus `figma-cli verify`, das der Melder stattdessen aufgerufen hatte; `render --verify` stand fest bei 1. Er bestätigte danach, den Befehl, über den er schrieb, nie ausgeführt zu haben. Beim Triagieren also die **Observed**-Zahl gegen den Codepfad halten, den die **Repro**-Zeile wirklich erreicht. Der Befund überlebt meist, die Erklärung selten.

- **Ein Doku-Verweis, den man nur in einer Übersicht sieht, wird nicht gelesen.** Die Panel-Session dazu, wörtlich: „Wenn dort steht ‚REFERENCE.md — 30 Themen', zahle ich keine Aufmerksamkeit dafür, weil ich nicht weiß, ob dort etwas steht, das ich nicht schon habe." Ein Verweis muss den **Unterschied** benennen, nicht den Umfang — und dort stehen, wo man beim Lesen darüber stolpert, nicht in einem Index.
- **Den Leser fragen, wo er tatsächlich vorbeikommt.** Ich wollte `render --verify` in `quick-reference` und `ai-verification` setzen — beide logisch, beide von der meldenden Session in 50 Operationen nie geöffnet. Gelesen wurden `jsx-syntax`, `critical-pitfalls` und das `--help` des gerade getippten Befehls. Die logische Stelle und die begangene Stelle sind selten dieselbe.

- **A fix that lands on one of two twin commands is not a fix.** `eval` learned to name an empty result in August; `run` — its own copy of the same three decisions — did not, and `REFERENCE.md` documented the behavior as if it covered both. The same friction was reported from the panel a second time, six weeks later, against a doc line that was already there and already wrong. When two commands share a decision, give them one function, not two copies that pass review separately.
- **`docs <topic>` is what a panel session reads; `REFERENCE.md` is not.** Three of four entries in this round asked for something REFERENCE.md either said or did not need to say. Documentation that only exists there does not reach the reader who files the report.

- **Numbers beat screenshots for layout bugs.** The upstream parity harness (`tests/live/parity-harness.mjs`) found that 9 of 10 cases rendered differently between `render` and `render-batch` — invisible in a screenshot, obvious in a node-tree diff. Any "auto-layout behaves weirdly" report is a measurement task, not an eyeballing task.
- **A silent no-op is worse than an error.** `minW`/`maxW`/`minH`/`maxH` were documented and accepted but never emitted; the same for `stretch`. Nothing failed, the output was just wrong. When adding a JSX prop, add the assertion that it reaches the node.
- **Pure decision + unit test, I/O in the command module.** That convention is why 598 tests run without a Figma instance. New logic that branches on state belongs in `src/lib/`.
- **A pure decision function is only as good as the probe feeding it.** `resolveConnectAction` had four unit tests and was correct; the bug sat in the boolean handed to it. When a tested decision misbehaves, instrument its inputs first — one `pgrep -f Figma` next to `pgrep -x Figma` named the cause in a single command.
- **Grep the repo for the outlier before designing a fix.** Five places ask whether Figma runs; four used `-x`, one used `-f`. The odd one out was the bug, and the majority spelled out the fix.
- **A fresh checkout fails `npm test` in a way that looks catastrophic.** Without `npm install`, 29 of 47 test files die on `Cannot find package 'ws' imported from src/figma-client.js`. Install first, then judge the suite.
- **The reporter's observation is evidence; the reporter's cause is a guess.** All three code bugs
  in the first panel-feedback round had a different cause than the entry proposed: the text style
  miss was a font's weight naming (`Text Medium`), not two naming schemes; `duplicate` was not
  refusing nested ids, it was timing out for every id; the "no instantiate command" wish already
  had a command, just one that needs a DESIGN.md. Reproduce the command, never the diagnosis.
- **Never flatten generated code onto one line.** The `figmaUse` callers did
  (`.replace(/\n/g,' ')`), and a `//` comment then swallows the rest of the line. The daemon
  reports a code error, `figmaEvalSync` reads that as a connection problem, falls back to its own
  CDP connection and dies in its 60 s `execSync` timeout — visible only as
  `Error: spawnSync /bin/sh ETIMEDOUT`, which looks like a broken connection and is a syntax
  error. The flattening was never needed: `figmaUse` parses with the `s` flag.
- **A 60-second silence is a story about the transport, and it is usually lying.** I recorded here
  that the sync eval path does not work while the daemon runs. Measured, it answers in 17–273 ms;
  what did not work was my own multi-line code. Time the cheap case before writing down that a
  whole path is dead.
- **`loadAllPagesAsync()` is not free.** On a file with 5235 instances it alone outlasts the 60 s a
  sync command has. Load pages only when a lookup has already missed.
- **Recognising a word in a payload is not knowing what ran.** The first version of the feedback
  hook matched `figma-cli` and `⚠` against the whole PostToolUse payload, on the reasoning that
  nothing had to be extracted. It fired on `tail -14 LEARNINGS.md` minutes after installation,
  because that file documents earlier findings. Any `cat`, `grep` or `git diff` over notes would
  have done it. The command belongs in a parser, and the failure markers belong to the response
  only — which is why that decision now lives in `src/lib/feedback-trigger.js` with tests.
- **A once-per-session latch must be spent on a hit, not on a firing.** The same false positive
  consumed the one reminder that session had, so a real friction afterwards would have got
  nothing. A silent miss is worse than a duplicate.
- **A test that litters is a bug in the test.** `tests/snapshot-cmd.test.js` made five temp
  directories per run and removed none; nine suite runs in one day left 45 of them, and it was
  noticed from the panel because `$TMPDIR` had grown to 1179 entries. `mkdtempSync` in a test needs
  its `t.after(() => rmSync(...))` in the same breath.
- **Reproduce before recording a bug.** The `render` note above originally blamed `<Rectangle>`. A five-minute matrix — Rectangle with hex / `var:` / no fill / `w="fill"`, then the same on Frame and Text — cleared the element, pinned `w="fill"` as the trigger, and led to the real cause one layer down (the `catch` block). A symptom written down as a cause misleads every later session.

## Fork Decisions (clementcopper)

- **Migrated from v1.1.1 to upstream v2.1.2 on 2026-08-16** by branching from `upstream/main` (branch `v2`) instead of merging. The merge was not viable: upstream had split `src/index.js` from 8342 to 31 lines, so a merge would have meant hand-resolving the old monolith against 67 changed lines. Old state kept in `archive/draft-v1`.
- **Kept from the fork:** `bin/fig-start`, `bin/fig-status`, and the non-destructive `connect`. Dropped as redundant: the 60-minute daemon idle timeout (upstream had the identical value), the README workflow section, and the pre-2.x `CLAUDE.md`.
- **Byte-identity of `docs/FIGMA-USAGE.md` dropped on 2026-09-02.** It was moved from upstream's `CLAUDE.md` unchanged so rename detection would carry upstream's edits in on every pull. The rule cost a judgement call on every documentation change and was broken twice in two days by panel feedback that had to be answered where the panel actually reads — `docs <topic>`, not `REFERENCE.md`. Decided on numbers, not on mood: upstream's last commit was 2026-08-12, our branch was **0 behind and 76 ahead**, eleven PRs sat open (our four since 16./17.08., a stranger's MCP-server PR #29 since 2026-07-07 with zero comments). 0 behind is what settled it — pulling stays free, so the remote and the four PRs stay; only the constraint went. Re-check those numbers before assuming upstream is still quiet.
- **Framelink MCP is anchored, not vendored (2026-09-02).** The division of labour lives in `skills/figma-cli/SKILL.md` and in a rule `bin/fig-feedback-setup` writes to `~/.claude/CLAUDE.md`; the server itself is registered at **user scope**, because the same key otherwise sits once per project in plain text in `~/.claude.json`. figma-cli has no MCP server of its own — upstream PR #29 proposes one and has been unread for eight weeks.

## Swift host (`swift-host/`, AppKit + SwiftTerm)

- **The window sizes itself from the layout.** Pinning the bands to the content view's edges makes AppKit run `_changeWindowFrameFromConstraintsIfNecessary`, which resolves to the *smallest* legal size — 272 points for a saved 380, 117 without a floor. `contentMinSize`, a low-priority width, an `==` constraint, an intrinsic width and re-asserting the size after the first pass were all measured and all failed. The cure is to position the top-level bands by frame and leave Auto Layout to the inside of each band.
- **Save the content rect, not the window frame.** `NSWindow(contentRect:)` takes content, `window.frame` includes the title bar — a round trip through the saved bounds grew the window 28 points on every launch. It looked like it settled only because it hit the top of the screen.
- **`NSStackView` spaces by alignment rects, not frames.** `NSTextField` and `NSButton` both report an inset there, so one spacing produced 6, 8, 6 and 4 points in the same row, and two icons constrained to the same width came out 18.0 and 18.5. Subclass with `alignmentRectInsets = NSEdgeInsets()` wherever spacing has to be uniform.
- **…and that applies to every new view, not just the ones that were fixed.** The bullet above was written months before the ring bar, and the ring bar hit exactly the same trap: the head's documented 5pt gap drew as 3.0. It stayed invisible while the stop button's glyph was smaller than its box and left optical air at the edges; the moment an icon filled the box, the two points showed. A learning about a class of bug does not travel to code written afterwards on its own — reach for the `alignmentRectInsets` subclass when a view is *created*, not when someone notices the gap.
- **A frame set by hand is discarded unless the view owns it.** `translatesAutoresizingMaskIntoConstraints = false` hands the frame to Auto Layout, and a view laid out manually by its parent then lands wherever Auto Layout puts it — with no error. Twice in one afternoon: the wrapping row's children all drew at the same origin, and the whole status line collapsed to one group. Both times `layout()` had computed the right rectangles and the measurements printed them, because the measuring happened before the discard. Any view a parent positions by frame needs it back on `true`.
- **A wrapping view's height depends on the width it has not been given yet.** Auto Layout asks `intrinsicContentSize` while the view is still zero wide, so every item lands on its own line and the answer is the tallest possible one — measured 212pt at all five panel widths, which is exactly five stacked rows. Override `setFrameSize` and invalidate when the width changes, and propagate that to whatever built its own height on top.
- **SwiftTerm reports the raw `waitpid` status, not an exit code.** `processTerminated(exitCode:)` receives `n` straight out of `waitpid(shellPid, &n, WNOHANG)`, so a process exiting 1 arrives as 256. The panel printed that number for as long as it existed, and every `code == 1` branch written against it was dead on arrival. Decode with `WIFEXITED`/`WIFSIGNALED` before comparing.
- **`NSButtonCell` cannot be talked into padding.** It puts an image flush against the leading edge, ignores extra width there, and its image-to-title spacing is not settable; shifting its rects fixes one edge and breaks the other. A button that needs icon *and* label with real padding lays them out itself in a stack.
- **A view that implements `draw(_:)` never gets `updateLayer`.** A background set there silently stops appearing — which is how the active tab lost its field the moment a close mark was added.
- **`NSColor.textBackgroundColor.cgColor` freezes the appearance** at the moment it is read, and SwiftTerm converts an assigned colour immediately (`nativeBackgroundColor` calls `getTerminalColor()`). Dynamic colours have to be resolved inside `effectiveAppearance.performAsCurrentDrawingAppearance`.
- **SwiftTerm's key handling is closed.** `keyDown`, `flagsChanged` and `doCommand` are `public override`, not `open` — nothing about it can be corrected from outside the module. `send(source:data:)` *is* `open` and is where every keystroke leaves for the PTY.
- **A terminal exiting must not close the app.** The Electron host writes `describePtyExit` into the tab and leaves it standing (`app/src/main.ts:738`); closing the tab instead took the whole window down whenever Claude Code ended.
- **Two SF Symbols the panel wants need macOS 15** (`arrow.trianglehead.*`). `NSImage(systemSymbolName:)` returns nil for an unknown symbol — no icon at all — so every name is asked for with a fallback.
- **Claude Code keeps a session's name in two places.** The `-n` value lands in the transcript as `agent-name`/`custom-title` records *and*, once renamed, in a sidecar `~/.claude/projects/<slug>/<session-uuid>/custom-title.json`. A sweep over `*/*.jsonl` alone leaves the sidecar standing, and the sidecar is what the picker shows.
- **`-n` alongside `--resume` renames the session the user picks.** The panel passed both on every respawn, so one session on disk ended up carrying two names. A spawn that adopts a conversation (`--resume`, `-r`, `--continue`, `-c`) must pass neither a name nor `--session-id`.
- **A guard that carries two things drops both.** `panelArguments` hung the status-line `--settings` off the same `!sessionName.isEmpty` guard as `-n`; the moment resume stopped passing a name, the tab would have lost its ring bar too.
- **`folding(.diacriticInsensitive)` deletes "ß" rather than folding it.** "Größen" slugs to `gro-en` unless ß is replaced with `ss` first. Umlauts do fold (ü → u), so only the sharp s needs the special case.
- **XCTest needs full Xcode.** With only the Command Line Tools `swift test` stops at "XCTest not available"; the ported cases run as a plain executable target instead.

## Dead Ends

- **`figma-use` as the transport.** Broken on Node 20+, hardcoded port, failed on FigJam, and `render` delegating to it was one of three disagreeing layout implementations. Upstream dropped the dependency in 2.1.1; `figmaUse()` in `src/lib/cli-core.js` is now just a native shim that kept the name. Do not reintroduce the package.
- **`layoutGrow` for `grow={1}`.** Deprecated and unreliable; use `layoutSizingHorizontal/Vertical = 'FILL'` on the parent's flex axis.
- **Guessing which wrapper compiles for `eval`.** Three regexes looking for `return` missed common shapes. `src/lib/eval-wrap.js` now asks the engine (`new Function(src)`) instead of guessing.
