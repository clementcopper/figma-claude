# Handoff — 2026-09-04 18:09
Arbeitsverzeichnis: /Users/danielmartin/figma-cli

## Stand
swift-host Review-Pass abgeschlossen und gepusht (`7b1f86e..18502f3`, 9 Commits auf `master`).
Sechs Bugs gefixt (Timeouts nie erzwungen, Transcript-Scan 1 320 → 14 ms, ⌘Q-Bounds, Data Race
`FigmaWatcher.snapshot`, Effort-Chip-Farbe eingefroren, leeres Fenster ohne `claude` auf PATH),
~900 tote Zeilen raus (alte `StatusLineView`, Spike-Meter, `respawning`, `PaddedCell`, …).
CoreChecks 490 grün. Bundle 1.0.1 gebaut und gestartet (PID 84576). Plan liegt in
`~/.claude/plans/check-mal-bitte-den-eager-pike.md`.

## Mitten drin
- Nichts. Arbeitsbaum sauber, `Sessions/` und Memory sind die einzigen ungetrackten Änderungen.

## Nächster Schritt
Daniel prüft in der laufenden 1.0.1: Fenster ziehen (Bänder folgen ohne `windowDidResize`?),
View ▸ Appearance wechseln (Effort-Chip folgt?). Dann CI-Lauf für 18502f3 auf GitHub ansehen.
Bei Befund: `cd swift-host && swift run CoreChecks` als Baseline, Fix als eigener Commit.

## Schon probiert, geht nicht
- System Events `quit` per `unix id` auf eine zweite App-Instanz tut nichts (Prozess lief weiter);
  Fenster-Zugriff über System Events ohne Accessibility-Recht auch nicht. Exakt per PID beenden:
  `NSRunningApplication(processIdentifier:).terminate()` (Swift-Snippet im Scratchpad, weg nach Clear).
- Live-Test für A6 (fehlendes `claude`) braucht Daniels `panel.json` — nicht angefasst, nur Check.
- `swift build` warnt immer „could not determine XCTest paths“ — Command Line Tools, kein Fehler.

## Was Daniel entschieden hat
- Alle drei großen Löschungen freigegeben: alte Balken-Ansicht + Probe, ThroughputMeter/`[spike]`,
  Controller-Umbau (lazy vars, `FigmaWatcher.onChange` settbar).
- Er hatte seine alte Panel-Instanz (PID 33825) selbst beendet — mein Verdacht, das AppleScript
  hätte sie getroffen, war falsch; die drei Einträge dazu sind wieder gelöscht.

## Erledigt und vom Tisch
- `--render-statusline` Probe und README-Zeile entfernt; `--render-rings --bar` zeigt die echte Ansicht.
- Doku-Dubletten (formatTokens, secondaryRowText, RenderProbe.about, measureCwd) bereinigt.
- Learnings in `LEARNINGS.md` § Swift host + `.claude/rules/swift-host.md` (45 Zeilen) committet.
