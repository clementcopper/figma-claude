# Handoff — 2026-09-03 11:59
Arbeitsverzeichnis: /Users/danielmartin/figma-cli

## Stand
Das Repo heißt jetzt **`clementcopper/figma-claude`**, hat **einen Stamm `master`** (Vorgabe-Branch)
und ein neu geschriebenes README, das Figma Claude nach vorn stellt — mit Screenshots, Statusleiste,
Figma-Menü, Tabs und Sessionnamen, dem Auswahlband und einem Vergleich gegen die reine CLI. Der
Swift-Host steht auf **1.0.0** und hat ein eigenes `swift-host/README.md`. CI läuft seit heute
überhaupt zum ersten Mal in diesem Fork: Node 18/20/22 auf Linux plus ein macOS-Job, der das
Swift-Paket baut und `CoreChecks` fährt — letzter Lauf grün. Drei gemeldete Bugs behoben (App
beendete sich beim Verzeichniswechsel, cwd-Knopf zeigte für alle Tabs dasselbe, Finder-Platzhalter-
Icon). 475 Swift-Prüfungen, 696 von 697 CLI-Tests, alles gepusht bis `191bb6a`.

## Mitten drin
- **Nicht von mir und nicht committet:** `.claude/rules/` (vier Dateien, 10:49) und eine geänderte
  Zeile in `CLAUDE.md`, die darauf verweist. Ich habe die heutigen Learnings in `process.md` und
  `swift-host.md` ergänzt, aber nichts davon eingecheckt — das ist Daniels Arbeitsstand.

## Nächster Schritt
```bash
cd ~/figma-cli && git status --short && git diff CLAUDE.md
# wenn der Stand passt:
git add CLAUDE.md .claude/rules && git commit -m "docs: path-scoped rules for the repo" && git push
```

## Schon probiert, geht nicht
- **`.build` in den CI-Cache legen.** Swift-Artefakte tragen absolute Pfade; nach der Umbenennung
  traf der Cache trotzdem (Schlüssel ist `Package.resolved`) und jeder Compile brach.
- **Den Ordner `~/figma-cli` mit umbenennen.** `~/.figma-ds-cli/bin/figma-cli` zeigt absolut hinein.
- **Die vier PR-Branches auf `origin` löschen.** Das schließt PRs #40/#41/#43/#44 bei silships.
- **Einen Probe-Hintergrund über `NSImage.lockFocus` komponieren.** Verwirft den Erscheinungs-
  Kontext, die Füllung wird immer hell aufgelöst.
- **Regeln == Geschichten hart prüfen.** Drei Regeln tragen absichtlich je zwei Geschichten; eine
  Zeile, die im Normalzustand rot ist, wird ignoriert.

## Was Daniel entschieden hat
- Repo umbenannt, **lokaler Ordner bleibt** `~/figma-cli`.
- Ein Stamm `master`; `v2` und `archive/draft-v1` sind jetzt die Tags `v2-final` und `draft-v1`.
- Upstream wird **gepickt, nicht gemerged**; `README.md` ist unser Text und wird nie abgeglichen.
- Swift-Host ist *die* App, Electron in `app/` ist der Vorgänger und wird nicht weiterentwickelt.
- Version **1.0.0**. Sessionnamen `fc-<figma-datei>-<session-id>`.
- Im cwd-Knopf steht **immer** der Ordnername; der Figma-Name gibt zuerst nach.

## Erledigt und vom Tisch
- Byte-Identität mit upstream — schon am 02.09. gefallen, heute auch fürs README.
- `CFBundleVersion` trägt den Git-Sha, LaunchServices liest daraus „17.0". Gemeldet, Daniel hat
  nicht reagiert; der About-Dialog braucht ihn dort. Nicht weiterverfolgen ohne seine Ansage.
- Ein zweiter macOS-CI-Job für `app/` (Electron) — nicht gebaut, wird nicht mehr entwickelt.
