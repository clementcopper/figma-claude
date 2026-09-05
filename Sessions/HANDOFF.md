# Handoff — 2026-09-05 08:14
Arbeitsverzeichnis: /Users/danielmartin/figma-cli

## Stand
Review-Plan vom 4.9. (`~/.claude/plans/schau-dir-mal-die-synthetic-bubble.md`) komplett
abgearbeitet: Pakete A–E, Tier 2, Peripherie, drei Konventionen, DESIGN.md-Hex-Fix. 61 Commits
seit `7ed0be5`, alle gepusht, CI grün (Node 18/20/22 + swift). Suite 697 → 923 Tests,
`figma-client.js` 5680 → 3430 Zeilen. Memory: `review-2026-09-04.md`. Die Panel-Session
`fc-designdone-a361a882` hat danach ~40 Befehle in Designdone/„CLI Lab" getestet und sechs
Befunde in `FEEDBACK.md ## Open` eingetragen.

## Mitten drin
- Die sechs Panel-Befunde sind ungefixt. Mein Vorschlag an Daniel (23:55): 1, 2, 3, 5 jetzt,
  4 und 6 später. Antwort steht aus.
  1. `get 9999:9999 --json` → Klartext, Exit 0 (`src/commands/canvas-ops.js`, `get`)
  2. `node bindings <bad> --json` → JSON-Fehler, aber Exit 0 (`node-ops.js`, `out.error`-Zweig)
  3. `render '<Frame><Text>x</Frame>'` → Warnung, ✓ Rendered, leerer Frame, Exit 0
  4. `bg="var:missing"` → grauer Platzhalter, Exit 0; Wunsch `--strict-vars`
  5. `node tree --help`, `node bindings --help`, `var export --help` → Top-Level-Hilfe (nicht reproduziert)
  6. `node tree --json` liefert Zeilen, keinen Baum (Designfrage)

## Nächster Schritt
`/feedback-triage` — dann je Befund RED-Test zuerst, wie in A–E. Für 5 erst reproduzieren:
`node src/index.js node tree --help | head -3`.

## Schon probiert, geht nicht
- Daemon-Integrationstest flackert unter Suite-Last (1 von ~5 Läufen), allein nie; Ursache ist
  Timing, nicht Code. Erneut laufen lassen, bevor eine Änderung verdächtigt wird.
- `curl http://127.0.0.1:9222/json` hing gestern minutenlang (Figma-seitig); Figma-Neustart half.
- Eine unbekannte Node-ID meldet Figma selbst als „Unable to establish connection to Figma after
  10 seconds" — das ist Figmas Text, kein Verbindungsproblem.

## Was Daniel entschieden hat
- Alle 80 aufruferlosen `FigmaClient`-Methoden löschen (2249 Zeilen), auf die Zahl hin.
- Smart-X-Einzeiler bleiben; DESIGN.md-Hex-Fix gemacht.
- Testseite für Live-Läufe: Designdone / „CLI Lab" (Harness: `PARITY_PAGE="CLI Lab"`).
- Pronomen für andere Sessions bleiben dem Satzanfang überlassen, keine Regel.

## Erledigt und vom Tisch
- Alles aus dem Plan; Tier-2-Konventionen (ID-Listen, delete, --json) inklusive.
- `docs scripting-the-cli` ist das Thema, das Panel-Sessions dafür lesen.
