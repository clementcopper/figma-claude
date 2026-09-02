# Handoff — 2026-09-02 11:35
Arbeitsverzeichnis: /Users/danielmartin/figma-cli

## Stand
Zehn Commits auf `feat/swift-host`, alle gepusht, Arbeitsverzeichnis sauber. Vier Panel-Einträge
aus `FEEDBACK.md` abgearbeitet (`## Open` ist leer). Framelink-MCP verankert und user-scope
registriert. Die Byte-Identität von `docs/FIGMA-USAGE.md` mit upstream ist aufgegeben. Der
Swift-Host heißt „Figma Claude", trägt das Icon und seit heute die **Ringleiste** als Statusbar
— live im Fenster, aus `StatusLineSnapshot` gespeist. Dazu behoben: Resume + ESC hinterließ ein
totes Terminal, und der Ordnername für Panel-Dokumente war an vier Stellen uneinheitlich.
439 Prüfungen im Swift-Host, 696 im CLI, alle grün.

## Mitten drin
- Nichts halbfertig. Letzter Commit `25a85b9`, App gebaut und laufend (Bundle 11:31).

## Nächster Schritt
Nichts Angefangenes. Bei neuer Arbeit am Swift-Host:
```bash
cd ~/figma-cli/swift-host && swift run CoreChecks && swift build -c release \
  && bash Tools/make-app.sh && open "build/Figma Claude.app"
```

## Schon probiert, geht nicht
- **`swiftc` direkt gegen `FigmaClaudeCore` linken** geht nicht (`library not found`) — SwiftPM
  legt keine so benannte Bibliothek ab. Logik, die geprüft werden soll, gehört nach
  `Sources/FigmaClaudeCore/` und wird über `CoreChecks` gefahren, nicht über eine Wegwerf-Binary.
- **`FIGMA_PORT=59999` isoliert einen CLI-Aufruf nicht**, solange der Daemon läuft — er hält die
  CDP-Verbindung. Ein `render` damit landet im echten Figma-Dokument.
- **`cd swift-host && …` aus dem Repo-Wurzelverzeichnis** schlägt fehl, wenn die Shell schon dort
  steht; die `&&`-Kette bricht dann still und `make-app.sh` baut aus einem alten Binary.
- **Aus einer Uhrzeit lässt sich kein Wochentag rekonstruieren** — die alten `weekResetsAt`-Werte
  (`01:00`) sind nicht reparierbar, sie werden beim nächsten echten Payload ersetzt.

## Was Daniel entschieden hat
- Ordnername **`Figma Claude` mit Leerzeichen** (nicht `FigmaClaude`) — liegt so auf der Platte.
- Comp-Ring: **höchstens 3 Segmente**, ab 3 Kompaktierungen alles rot, darüber Randfall.
- Umgebrochene Zeilen der Statusleiste bleiben **linksbündig**, nur einzeilig wird zentriert.
- Upstream: Remote und die vier PRs bleiben, nur der Byte-Identitäts-Zwang fällt.
- Der Framelink-Token wird **nicht** rotiert („ist ok so").

## Erledigt und vom Tisch
- Resume-ESC-Fix von Daniel geprüft und bestätigt.
- `bin/fig-feedback-setup` bringt jetzt auch den SessionStart-Hook mit.
- Die 477 unfestgeschriebenen Zeilen der anderen Session sind als `a28ecd1` committet.
