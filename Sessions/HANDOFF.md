# Handoff — 2026-09-06 11:04
Arbeitsverzeichnis: /Users/danielmartin/figma-cli

## Stand
Zwei Pakete am 05.09., alles auf master gepusht, Suite 956 grün, CoreChecks 533:
1. `/feedback-triage`: 22 Panel-Befunde geschlossen (Commits 84253a0 … ee2e4ac). Kern: der
   Exit-Code-Wächter kannte nur eine Schreibweise von ✗; erweitert, neun stille Stellen gefixt.
   Neu: `--strict-vars`, `node tree --json` mit `tree`, `var list -c/-t/--json`, a11y Exit 1 bei
   Verstoß, `tokens components` beendet sich (0,9 s), Programmname überall `figma-cli`.
2. Swift-Host 1.1.0 (f0a8308): Sessionnamen `fc-<datei>-<seite>` beim Start, nach dem ersten
   Prompt `/rename fc-<w1>-<w2>` per Haiku (`SessionRenamer.swift`, README § Session names).
   Ledger `~/.figma-ds-cli/session-names.json`. Live bestätigt: Tab 19:07:59 → `fc-initial-greeting`
   19:08:16. Daniel beobachtet es im Betrieb; FEEDBACK.md ist leer.

## Mitten drin
- Nichts halb offen. Beobachtungen aus dem Betrieb kommen als `app`-Einträge in FEEDBACK.md.

## Nächster Schritt
Nächste Session beginnt mit dem Hook-Zähler; wenn > 0: `/feedback-triage`. Sonst frei.
Für Panel-Befunde zum Rename zuerst: `cat ~/.figma-ds-cli/session-names.json` und
`for f in ~/.claude/sessions/*.json; do node -e 'const j=require(process.argv[1]);console.log(j.name,j.nameSource,j.status)' $f; done`

## Schon probiert, geht nicht
- Figma antwortet auf eine fehlende Node-ID nach dem ersten Lookup mit „Unable to establish
  connection to Figma after 10 seconds" — Figmas Text, Exit 1 trotzdem. `figma.getNodeById`
  (sync) liefert null in 0,3 s; nicht umgebaut, in LEARNINGS notiert.
- `tokens components`-Befunde „stiller Ersatz ohne --replace" und „fremder SLICE" reproduzieren
  nicht (drei Läufe); wenn sie wiederkommen, den Befehl davor notieren.
- Daemon-Integrationstest flackert unter Suite-Last (1 von ~5); allein nie. Erst wiederholen.

## Was Daniel entschieden hat
- Sessionnamen: FC vorn, zwei Aufgabenwörter, immer eindeutig; Startname Datei + Seite; Haiku
  benennt nach dem ersten Prompt. Vorschlag „erst ein Prompt mit ≥ 3 Inhaltswörtern" offen
  gelassen — erst beobachten.
- a11y: Exit 1 bei Verstoß (audit nur bei error); `--strict-vars` als Flag, Default bleibt.
- Push macht Daniel selbst.

## Erledigt und vom Tisch
- Alle 22 Feedback-Einträge inklusive #5 (zsh-Loop des Reporters, kein CLI-Bug).
- Panel-Session hat Rule-Split in `Design/.claude/rules` selbst gemacht; nichts hier zu tun.
