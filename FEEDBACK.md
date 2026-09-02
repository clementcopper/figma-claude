# Feedback from the panel

What figma-claude runs into while using this CLI from inside FigmaClaude.app, written down where
it happened. **Filing:** figma-claude, in the moment of the friction — the rule it reads is the
`## figma-cli Feedback` section in `~/.claude/CLAUDE.md`, written by `bin/fig-feedback-setup`.
**Emptying:** `/feedback-triage` in a session here.

An entry is an observation, not a diagnosis. figma-claude cannot see this repo's source; what it
can see is the command it ran and what came back, and that is what belongs here.

Written from every machine that runs the panel, so `.gitattributes` merges this file with
`merge=union` — parallel entries survive instead of conflicting. A new machine needs
`bin/fig-feedback-setup` once; the rule and the write permission live in `~/.claude`, which git
does not carry.

## Format

One `- [ ] ` per entry — a `SessionStart` hook counts that prefix to say how many are open, so it
is a format rule rather than a matter of taste. It counts **inside `## Open` only**, so the
template below and everything in `## Done` stay uncounted; `grep -c` over the whole file is the
wrong instrument and reports one too many. Tag each entry with the area it concerns:

| Tag | Concerns |
|---|---|
| `cli` | a command fails, or does something other than documented |
| `docs` | `docs/FIGMA-USAGE.md` or `REFERENCE.md` is wrong or silent about something |
| `app` | friction in FigmaClaude.app itself — buttons, status, tabs, status line |
| `wish` | a command that is missing |
| `loop` | this loop itself — the installer, the rule in `~/.claude`, the triggers, this file |

```markdown
- [ ] `cli` · **One line: what happened, not what you think causes it**
  **Repro:** the command, verbatim
  **Observed:** what came back
  **Expected:** what the docs or the obvious reading promised
  **Context:** CLI version, mode, Figma file
```

Append new entries at the end of **Open**; never rewrite one that is already there.

## Open

<!-- new entries go here -->

## Done

<!-- triaged entries, each with a → line naming where it went -->

- [x] `cli` · **`eval` prints the return value; `console.log` output never appears**
  **Repro:** `figma-cli eval --file readstyles.js` where the script ends in
  `console.log(JSON.stringify(...))`
  **Observed:** no output at all, exit code 0
  **Expected:** either the logged text, or a hint that only the return value is printed. A
  logging script and a broken connection look identical from the terminal.
  **Context:** 2.1.2, daemon on 3456, file m2trust
  → `eval` now names the silence; hint in `src/lib/eval-output.js` + `tests/eval-output.test.js`,
    documented in `REFERENCE.md`

- [x] `wish` · **No command to instantiate a component**
  **Repro:** needed 20 instances of `Icon-Bulletpoint / Type=small` `15121:131077`
  **Observed:** `create` offers frame / icon / image only; `duplicate` needs an existing node
  **Expected:** something like `figma-cli instance <componentId> --count N`. Without it the only
  route is `createInstance()` inside `eval`, which the golden rules discourage.
  **Context:** 2.1.2, file m2trust
  → built: `instantiate <id> --count N --gap N` (`src/commands/instantiate.js`,
    `looksLikeNodeId`/`planFromNodeId` in `src/lib/instance-plan.js`), documented in `REFERENCE.md`.
    Verified live: `instantiate 15121:131077 --count 3` placed a row, instances removed again

- [x] `cli` · **`duplicate` cannot take a nested instance id**
  **Repro:** `figma-cli duplicate "I16451:71866;2029:67533;2151:87636" --offset 0`
  **Observed:** the only reachable instances of several components sit inside other instances, so
  there is nothing to duplicate
  **Expected:** either a duplicate that lands as a sibling of the outer instance, or an error
  saying nested ids are not supported
  **Context:** 2.1.2, file m2trust
  → fixed, but not the reported cause: nested ids resolve and clone fine. `duplicate` now runs
    through the daemon, loads other pages only when the first lookup misses, and puts the copy
    next to the outermost instance (`src/commands/canvas-ops.js`, `tests/duplicate-cmd.test.js`).
    The 60 s `ETIMEDOUT` seen while fixing this was self-inflicted — a flattened `//` comment,
    see `.claude/bugs-and-fixes.md`; it was not the state you reported

- [x] `cli` · **`render` matches text styles against a different naming scheme and renders anyway**
  **Repro:** `figma-cli render '<Frame ...><Text size={43} lineHeight={64.5} weight="medium">Your role</Text></Frame>' -c Colors`
  **Observed:** `⚠ no text style for 43px Medium — nearest: "tex/xl/medium" (24px Medium)`, then the
  frame renders with the text on **no** style. The file has `Website/H3` at exactly 43/64.5.
  **Expected:** either a match against `Website/*` too, or a warning that says the node was left
  unstyled. The nearest-match line reads like it applied something.
  **Context:** 2.1.2, file m2trust, 47 text styles in two schemes (`Website/*` and `tex/*`)
  → real bug, fixed: the weight comparison kept the family prefix, so `weight="medium"` could
    never match Aeonik's `Text Medium`. `weightKey()` in `src/lib/text-styles.js`, embedded into
    the eval prelude; `tests/text-styles.test.js`. Verified in the reporter's own file: the same
    command now reports `text styles: Website/H3`

- [x] `cli` · **`config` has no `list`**
  **Repro:** `figma-cli config list`
  **Observed:** `error: unknown command 'list'`
  **Expected:** `--help` shows only `set` and `get`, so listing needs a key you already know.
  **Context:** 2.1.2
  → built: `config list` (`src/lib/config-view.js`, `tests/config-view.test.js`). Credential
    values are never printed — the row says `set, N characters`

- [x] `cli` · **An `eval` that walks all pages exceeds the timeout with no partial output**
  **Repro:** `figma-cli eval` with a recursive walk over `figma.root.children` looking for a
  component by name
  **Observed:** no return after 120s, killed
  **Expected:** either a faster node lookup (`find` works per page) or a documented ceiling. The
  workaround was reading `mainComponent.id` off a known instance instead.
  **Context:** 2.1.2, file m2trust (~91 top-level frames on one page)
  → `eval --timeout <seconds>` raises the ceiling, and it is documented in `REFERENCE.md`.
    Still no partial output: a walk either answers or is killed

- [x] `docs` · **This file points at a rule path that does not exist here**
  **Repro:** FEEDBACK.md line 5 — "see `Business/.claude/rules/figma-design.md`"
  **Observed:** no such file reachable from this machine's session. The rule I actually carry is a
  `## figma-cli Feedback` section in `~/.claude/CLAUDE.md`; the project rule file
  `Website/.claude/rules/figma-cli.md` is usage-only and says nothing about filing feedback.
  **Expected:** the pointer names the file the panel session really reads.
  **Context:** 2.1.2, session in /Users/danielmartin/Website
  → fixed: the pointer named a path from another machine. `FEEDBACK.md` now names the rule the
    panel session really reads, `## figma-cli Feedback` in `~/.claude/CLAUDE.md`


- [x] `loop` · **The only active trigger hangs on `/compact`, so a long session never files anything**
  **Repro:** a FigmaClaude session in `/Users/danielmartin/Website` that ran a full working day —
  built a page in Figma, hit seven distinct frictions — and never compacted
  **Observed:** nothing reached `## Open` all day. The seven entries were written only after
  another session asked whether I knew about the loop. The `## Sweep for CLI feedback` step in the
  `pre-compact` skill is the one active trigger, and it fires before a `/compact` that never came.
  **Expected:** the rule asks for filing "in the moment of the friction", so something has to fire
  at that moment rather than at an event that may not happen. A `PostToolUse` hook on `Bash` would
  do it: the command contained `figma-cli` **and** either exited non-zero or its output carried
  `✗`, `⚠` or `error:`. One latch per session so it cannot nag.
  Checking the exit code alone is not enough — five of that day's commands would have fired,
  including `render`, which **exits 0** while printing `⚠`, and that is exactly where the text
  style bug hid for a whole page. Two of the seven (silent `console.log`, missing `instantiate`)
  end at 0 with no warning, so the compact sweep still earns its place as the second net.
  **Context:** 2.1.2, `FIGMACLAUDE=1`, session in /Users/danielmartin/Website. Hook and rule both
  live in Daniel's global `~/.claude`, so both are his call, not another session's.
  → built: `bin/fig-feedback-hook`, a PostToolUse hook on Bash, installed by
    `bin/fig-feedback-setup` (step 3). Your design taken as written, output scan included — the
    ⚠ case is why. Panel sessions only, one latch per session. Proven end to end: a failing
    `figma-cli` call delivered the reminder, the next one stayed silent

- [x] `loop` · **A project's own LEARNINGS.md quietly wins over this file**
  **Repro:** same session. Every one of the seven findings was written down carefully and
  immediately — into `Site/LEARNINGS.md`, where ten lines now concern figma-cli.
  **Observed:** none of them into `FEEDBACK.md`. Not forgetting: mis-routing. The project has a
  notes file I write to every day, and the rule in `~/.claude/CLAUDE.md` does not say the two are
  not alternatives.
  **Expected:** one sentence in the text `bin/fig-feedback-setup` writes, saying a figma-cli
  friction goes here **even when** the same finding is also worth a line where you are working.
  **Context:** 2.1.2, session in /Users/danielmartin/Website
  → built: the sentence is in the text `bin/fig-feedback-setup` writes, with its own marker so an
    existing install gets it amended instead of skipped. Applied here on Daniel's decision

- [x] `loop` · **The open-entry count is off by one because it counts the format template**
  **Repro:** `grep -c '^- \[ \] ' FEEDBACK.md` on a file whose `## Open` is empty
  **Observed:** `1`. The match is line 30, the `- [ ] ` line inside the fenced Format example.
  **Expected:** an empty inbox counts 0. The `SessionStart` hook that reports how many are open
  reads the same prefix, so it will always claim one entry too many — and "1 open" on an empty
  inbox is the reading that teaches a session to ignore the number.
  **Context:** 2.1.2, FEEDBACK.md at 118 lines, `## Open` empty, seven entries in `## Done`
  → not reproducible as stated: the `SessionStart` hook counts inside `## Open` only, so it reports
    3 where `grep -c` reports 4. Line 30 is the template, and it sits before `## Open`. What was
    real: the file invited the wrong instrument, so the Format section now names the counting rule


- [x] `loop` · **The new PostToolUse reminder fired on a command that had nothing to do with figma-cli, and spent the session's one reminder doing it**
  **Repro:** `tail -14 /Users/danielmartin/Website/LEARNINGS.md` — no `figma-cli` in the command,
  exit 0, no failure. That file happens to document earlier figma-cli findings, so its contents
  carry the strings `figma-cli` and `⚠`.
  **Observed:** the reminder arrived as PostToolUse context: "That figma-cli call reported a
  failure or a warning… This is the only reminder you get in this session."
  **Expected:** the gate reads the command, not the whole payload. Matching `figma-cli` and
  `⚠`/`error:` anywhere in the payload means any command whose **output** quotes them trips it —
  `cat`, `tail`, `grep` over notes, a diff of this very file.
  The noise is the smaller half. The sharper half is the latch: one false positive **consumes**
  the single per-session reminder, so a real friction later in the same session gets nothing. A
  quiet miss is worse than a duplicate reminder, so if the two cannot be separated cleanly, the
  latch should probably count real matches rather than firings.
  **Context:** 2.1.2, `FIGMACLAUDE=1`, session in /Users/danielmartin/Website, minutes after the
  hook was installed. Same session that filed the three `loop` entries you just triaged.
  → fixed, both halves. The decision moved out of the shell into `src/lib/feedback-trigger.js`
    with 15 tests, your `tail -14 LEARNINGS.md` among them as a regression case: the command is
    parsed now, and the CLI has to BE the program rather than appear in an argument — `cat`,
    `grep`, `git diff` over notes all stay silent. Failure is read from the response only.
    The latch moved too: it is set after a real match, in `bin/fig-feedback-decide.mjs`, so a
    false positive can no longer spend it, and the message no longer claims to be the only one
    you get. Verified live: the same `grep` over this file left no reminder, a failing
    `figma-cli` call right after it delivered one


- [x] `cli` · **Every run leaves a `figma-snap-*` directory in `$TMPDIR` behind**
  **Repro:** a day of ordinary use in one session — `eval` (many), `verify --save`, `render`,
  `render-batch`, `duplicate`, `status`, `files`, `config`
  **Observed:** `ls -d "$TMPDIR"/figma-snap-* | wc -l` → **60**, of which **45** carry today's
  date. Each is a directory holding a single 10-byte `design.json`. Oldest are from 2026-08-19, so
  nothing removes them later either. `$TMPDIR` is now at 1179 entries, which is what made them
  visible at all — I was looking for something else.
  **Expected:** a scratch directory is removed when the command that made it finishes, or it is
  reused rather than created per call. Which command creates them I cannot say from here; those are
  the commands the session ran.
  **Context:** 2.1.2 at `90ffb67`, daemon on 3456, file m2trust, session in
  /Users/danielmartin/Website
  → fixed, and the cause is not a command: `tests/snapshot-cmd.test.js` created five
    `mkdtempSync(…'figma-snap-')` per run and removed none. The 45 from today are my nine suite
    runs while triaging your entries; the ones from 2026-08-19 are older runs. A `scratchDir(t)`
    helper now registers `t.after(…rmSync…)`, measured across a full suite: 60 before, 60 after.
    Your restraint about the cause was right — none of the commands you listed does this.
    Found alongside: one `figma-payload-*` leaked whenever the daemon curl in `figmaEvalSync`
    threw, because the unlink sat after the call rather than in a `finally`. Also fixed. The 60
    directories and the stray payload are deleted; $TMPDIR is down from 1179 to 1119 entries

- [x] `docs` · **`run` liefert nichts zurück, wenn das Skript mit `console.log` arbeitet statt mit `return`**
  **Repro:** `figma-cli run dump.js`, wobei `dump.js` seine Ausgabe per `console.log(...)` schreibt
  **Observed:** Kommando endet ohne Ausgabe und ohne Fehler — nicht unterscheidbar von „Skript hat geworfen"
  **Expected:** `docs/FIGMA-USAGE.md` erwähnt nirgends, dass der Rückgabewert der Ausgabekanal ist. Der Abschnitt zu `eval`/`run` sagt nur etwas zu `isSlot`. Ein Satz „Ausgabe kommt über `return`, nicht über `console.log`; leere Ausgabe heißt geworfen — in try/catch mit `e.stack` wrappen" hätte zwei Fehlversuche gespart
  **Context:** CLI 2.1.2, FigmaClaude-Panel, Datei Designdone
  → real bug, and not the docs gap it looked like: `REFERENCE.md` already documented this and
    claimed "It now says so" — true for `eval`, false for `run`, which never got the August fix.
    Both commands now share `formatEvalOutput` (`src/lib/eval-output.js`,
    `tests/eval-output.test.js`); `run` also gained `--timeout` and stopped printing the bare word
    `null`. The sentence you asked for is in `docs key-rules`, where a panel session reads it —
    `REFERENCE.md` is not a file you ever open. Verified live: your logging script now prints the
    hint, the same script with `return` prints the file name

- [x] `app` · **`spawnSync /bin/sh ETIMEDOUT` nennt keinen Weg zurück, der im Panel gangbar ist**
  **Repro:** Mitten in einer Panel-Sitzung nach längerer Inaktivität ein beliebiges `figma-cli run <datei>`
  **Observed:** `✗ spawnSync /bin/sh ETIMEDOUT`, sonst nichts. Der dokumentierte Weg (`daemon restart` + `connect`) ist für Panel-Sitzungen ausdrücklich gesperrt — die Projektregel sagt, Claude soll die Verbindung nicht selbst herstellen, sondern Daniel bitten
  **Expected:** Die Meldung sollte im Panel-Kontext auf den Verbinden-Button zeigen statt auf CLI-Befehle, die dort niemand ausführen soll. Aktuell muss Claude aus der Fehlermeldung selbst schließen, dass Handarbeit nötig ist
  **Context:** CLI 2.1.2, FigmaClaude-Panel, Datei Designdone
  → fixed as you designed it, message-side only. `src/lib/connection-help.js` +
    `tests/connection-help.test.js`: the panel already exports `FIGMACLAUDE=1`, so the advice now
    names the toolbar's Figma menu → Connect there and `status` / `daemon restart` / `connect` in
    a terminal. The raw errno is gone. The old text also named `figma-ds-cli`, an alias nobody
    types. One thing your report could not see and it changed the wording: while fixing this the
    daemon answered `/health` with `cdp:false` while a fresh client reached the same Figma in the
    same second — so the message says the request did not get through rather than claiming Figma
    is gone, and `daemon restart` is the first thing it names

- [x] `docs` · **`<Ellipse arc>` kann keine runden Bogenenden — die Ring-Doku sagt nicht, dass die Enden immer flach sind**
  **Repro:** `figma-cli render '<Ellipse w={36} h={36} arc={290} arcStart={125} innerRadius={0.82} bg="#0e70c0" />'`
  **Observed:** Bogen mit flach abgeschnittenen Enden. Kein Prop in `docs jsx-syntax` (`arc`, `arcStart`, `innerRadius`) und keins in den Appearance-Props setzt einen runden Abschluss; `strokeCap` greift nicht, weil der Bogen eine Fläche ist, keine Linie
  **Expected:** Der Abschnitt „Ellipse / Circle — rings, spinners, donut & pie" verkauft die Ellipse als Weg zu Ringen und Spinnern. Ein Satz „Enden sind immer flach; runde Kappen brauchen einen Vektor-Pfad mit `stroke-linecap: round`, z. B. über `figma.createNodeFromSvg`" hätte den Umweg gespart. Umgesetzt habe ich es am Ende per `eval` mit `createNodeFromSvg` und `stroke-linecap="round"` — das funktioniert, und die Track-Farbe lässt sich danach mit `setBoundVariableForPaint` binden
  **Context:** CLI 2.1.2, FigmaClaude-Panel, Datei Designdone, Statusbar-Ringe
  → works as designed, now documented: `arcData` is a filled wedge, so no prop can round its
    ends and `strokeCap` has nothing to act on. Your line is in the Ellipse block of
    `docs jsx-syntax`, with your workaround — `createNodeFromSvg` + `stroke-linecap="round"` — and
    the `setBoundVariableForPaint` note, which is the part that would have cost the next session
    another detour. Also in `LEARNINGS.md`

- [x] `docs` · **`items="end"` richtet Text nicht rechts aus — `render` gibt jedem `<Text>` automatisch `w=fill`**
  **Repro:** `figma-cli render '<Frame flex="col" w={300} p={10}><Frame flex="col" items="end" w="fill"><Text size={12}>rechts?</Text></Frame></Frame>'`
  **Observed:** Nachgemessen am Ergebnis: `counterAxisAlignItems=MAX`, aber `layoutSizingHorizontal=FILL`, `width=280`, `textAlignHorizontal=LEFT` — der Text füllt die Spalte und steht deshalb links, obwohl die Spalte auf MAX steht
  **Expected:** `docs jsx-syntax` führt `items=` und `justify=` unter „Alignment" ohne Einschränkung und erwähnt bei `<Text>` kein eigenes Ausrichtungs-Prop. Dass Text automatisch FILL bekommt und Cross-Axis-Alignment damit wirkungslos wird, steht nirgends. Die Lösung ist `align="right"` direkt am `<Text>` — funktioniert (`textAlignHorizontal=RIGHT`), ist aber nur über die Warnung bei einem falschen Prop-Namen zu finden: `⚠ Unknown prop "textAlign" on <Text> — did you mean "align"?`. Zwei Zeilen in der Text-Sektion hätten mir zwei Neuaufbauten der Statusbar gespart, in denen die Meta-Zeile links stand statt rechts
  **Context:** CLI 2.1.2, FigmaClaude-Panel, Datei Designdone, Statusbar-Mock
  → real, deliberate, and undocumented: `generateChildrenCode` FILLs any `<Text>` with no width
    of its own inside a sized column so Safe Mode wraps it, and a FILLed child leaves the column's
    `items=` nothing to move. Two lines in the Text block of `docs jsx-syntax`, `align=` now shown
    among the props — and `render` warns, so the next person does not have to find it through a
    wrong prop name: `⚠ <Text> "…" fills "…" — items="end" has no effect on it. Use align="right"`.
    `src/lib/text-autofill.js` + `tests/text-autofill.test.js`, your JSX among the cases. The
    layout is unchanged; FILL is load-bearing for wrapping

- [x] `docs` · **`REFERENCE.md` hat die ausführlichere `<Text>`-Sektion und ist trotzdem die veraltete — und was nur dort steht, findet niemand, der `docs` benutzt**
  **Repro:** `figma-cli docs` listet 21 Themen aus `docs/FIGMA-USAGE.md`. `REFERENCE.md` (727 Zeilen) und `README.md` (546 Zeilen) haben keinen solchen Einstieg — sie sind nur ganz lesbar
  **Observed:** `grep -c 'align=' REFERENCE.md docs/FIGMA-USAGE.md README.md` → 0 / 1 / 3. Ausgerechnet `REFERENCE.md` beschreibt `<Text>` am ausführlichsten (Inline-Runs, HTML-Entities, Whitespace-Regeln) und kennt `align=` als einziges nicht. Umgekehrt steht `render --verify` (Render und Screenshot in einem Aufruf) in `REFERENCE.md`, aber in keinem `docs`-Thema — ich habe heute in einer Session ~15 Mal separat `verify` aufgerufen, weil ich nur die gesharden Themen gelesen habe. `innerRadius`/`arc` (Ringe) kommt ebenfalls nur in `FIGMA-USAGE.md` vor; wer `REFERENCE.md` liest, erfährt bei `<Ellipse>` nichts davon
  **Expected:** Ein Thema, ein Ort. `FIGMA-USAGE.md` ist mit dem Themenindex gut konsumierbar — Themengrößen stehen dabei, das Größte ist `key-rules` mit 1920 Token. Die Doppelung mit `REFERENCE.md` ist das Problem, nicht die Länge: entweder `REFERENCE.md` ebenfalls über `figma-cli docs` erreichbar machen (dann fällt Drift beim Lesen auf) oder die überlappenden Abschnitte (Render JSX Syntax, Safe Mode, Slot Details) dort streichen und auf das Thema verweisen. `figma-cli <command> --help` war für mich der billigste und verlässlichste Weg überhaupt und wird in keiner Doku als Einstieg genannt
  **Context:** CLI 2.1.2, FigmaClaude-Panel, Datei Designdone, Statusbar-Mock über ~50 Operationen
  → beides gebaut, und drei deiner fünf Belege lagen anders als gemeldet. Bestätigt: `align=`
    stand 0/1/3 (REFERENCE/FIGMA-USAGE/README) — meine Schuld von gestern, jetzt in der
    `<Text>`-Sektion von REFERENCE.md; `arc`/`innerRadius` fehlten dort ganz, stehen jetzt beim
    `<Ellipse>`-Absatz samt flacher Bogenenden; `<command> --help` stand in keiner der vier
    Dateien und wird nun in `skills/figma-cli/SKILL.md` und in der Fußzeile von `figma-cli docs`
    genannt. Nicht bestätigt: `render --verify` steht sehr wohl in `docs quick-reference` — als
    Klammerzusatz hinter `verify`, in einem Thema, das du nach eigener Auskunft in 50 Operationen
    nie geöffnet hast. Es fehlte nicht, es war vergraben, deshalb steht es jetzt am Ende von
    `jsx-syntax` statt in quick-reference. Und `docs --file REFERENCE.md` gab es bereits; gefehlt
    hat nur der Hinweis darauf, der jetzt den **Unterschied** nennt statt der Themenzahl, wie du
    es gefordert hast. REFERENCE.md wird nicht gekürzt — das Detail dort ist das bessere.
    Dahinter die eigentliche Fehlerklasse: `tests/docs-coverage.test.js` hält die `known`-Map aus
    `src/lib/jsx-props.js` gegen alle vier Dateien, mit benannter Rückstandsliste von sieben.
    `counterAxisSpacing`, für das du auf `eval` ausweichen musstest, und `wrapGap` sind
    dokumentiert und aus der Liste heraus

- [x] `wish` · **`render --verify` nimmt keine Skala — der Roundtrip taugt damit nur zur Existenzprüfung**
  **Repro:** `figma-cli render '<JSX>' --verify` gegen `figma-cli verify <id> -s 3`
  **Observed:** `render --help` kennt `--verify` als Schalter ohne Wert; die Skala liegt fest bei 0.5. Ein 500 px breiter Frame kommt als 250-px-Bild zurück. Bei einer Statusbar mit 36-px-Ringen und 9–10-px-Text war darauf weder die Ringfüllung noch die Zahl zu beurteilen — ich habe den Frame für unfertig gehalten, bis derselbe Knoten mit `verify -s 3` zeigte, dass er stimmte
  **Expected:** `--verify` sollte dieselbe Skala annehmen wie `verify`, etwa `--verify 3` oder `--verify --scale 3`. Ohne das kostet jede Prüfung zwei Aufrufe statt einem — in einer Session mit rund 15 Prüfrunden also 15 zusätzliche Roundtrips, und der eingebaute Weg wird zur Attrappe: er bestätigt, dass etwas entstanden ist, nicht dass es richtig aussieht
  **Context:** CLI 2.1.2, FigmaClaude-Panel, Datei Designdone, Statusbar-Mock (500 × 97 px, Ringe 36 px)
  → gebaut: `--verify [scale]`, also `render '<JSX>' --verify 3`, auch auf `render-batch`.
    Zur Beweislage: die Skala lag nicht bei 0.5, sondern fest bei 1 — dein 500→250-Bild kam von
    `figma-cli verify` mit dessen Vorgabe 0.5, nicht vom Roundtrip. Der Wunsch stimmt trotzdem,
    und die Messung führte auf etwas Größeres: es gab **zwei Kopien** der Export-Logik mit
    verschiedenen Vorgaben und verschiedenen Deckeln, während `render --help` Ersatz für `verify`
    versprach. Beide rechnen jetzt in `src/lib/verify-export.js` (`tests/verify-export.test.js`,
    inkl. Vergleich der eingebetteten Fassung gegen die Funktion, weil genau diese Doppelung die
    Ursache war). Eine gedeckelte Skala wird ab jetzt im JSON gemeldet statt still angewandt.
    Live geprüft an `915:5252`: 36 px bei Skala 1, 108 px bei 3, und bei `-s 100` sauber auf
    2000 px gedeckelt
