# Handoff — 2026-09-11 14:02
Arbeitsverzeichnis: /Users/danielmartin/figma-cli

## Stand
Pipe-Modus komplett gebaut, live gegen echtes Figma validiert und Default auf macOS/Linux. Daemon startet Figma über `--remote-debugging-pipe` (kein Patch, kein Port, Signatur intakt), Handoff bei `daemon restart`. Das Figma-Claude-Panel (swift-host, primär) bekam eine schwebende Status-Karte (`StatusOverlay`) statt des abgeschnittenen Button-Toasts, modusabhängige Statuspunkte, und das Mode-Menü in Reihenfolge Pipe/Safe/Yolo/Browser. README und SECURITY.md nachgezogen. Alles committet, Arbeitsbaum sauber (nur `swift-host/Scrennshots/` untracked, absichtlich).

## Nächster Schritt
Neu gebaute App am echten Figma-Fenster abnehmen: `open "swift-host/build/Figma Claude.app"`, dann Mode Pipe→Safe→Yolo→Pipe durchklicken, Overlay + Punkte prüfen. Falls Weiterentwicklung: Safe-Mode-Payload optimieren (Exporte als `Uint8Array` statt Number-Array, gemessen ~4x langsamer) — Stellen im Plan § "Safe Mode messen".

## Schon probiert, geht nicht
- ✓-Symbol mit einer Palette-Farbe rendert als voller grüner Kreis (Häkchen unsichtbar) → `hierarchicalColor` nutzen.
- Frisch gestartetes Figma (Pipe) stellt den Design-Tab wieder her, lädt das Dokument aber nicht; `Target.activateTarget` über CDP erzwingt es nicht → Nutzer muss die Datei öffnen, dann greift der Watcher.
- Von Daniel eingefügte Screenshots kamen als generische PNG-Platzhalter an; echte Bilder lagen unter `swift-host/Scrennshots/` und mussten von dort gelesen werden.
- `daemon-live.test.js` (413-Body) flaked zweimal unter Last; allein grün 8/8. Kein echter Fehler.

## Was Daniel entschieden hat
- Alle vier Modi bleiben; Menü-Reihenfolge Pipe, Safe, Yolo, Browser. Yolo = `--patch` (Legacy).
- Erfolgs-Dialog bleibt stehen bis Schließen; keine Emojis in Panel-Texten (Slop).
- `package.json` author → designdone/designdone.de; README-Attribution an Sil + LICENSE bleiben (MIT).
- Kein asar-Backup (Byte-Rückbau reicht, Signatur rettet kein Backup).

## Erledigt und vom Tisch
- Pipe-Spike, Umsetzung, Live-Test aller drei Modi, Transport-Benchmark (Round-trip gleich, Safe ~4x bei Payload).
- Overlay-Status-Karte inkl. Wartezustand "run the FigCli plugin" bis Plugin verbindet.
- Sil/intodesignsystems-Werbezeilen aus der CLI-Ausgabe.
- 4 offene Punkte aus den Screenshots (Padding, waiting-for-plugin im Toast, Yolo-Punkte, Menü-Reihenfolge).
