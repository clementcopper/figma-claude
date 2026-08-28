import Foundation
import FigmaClaudeCore

/// Ported from `app/tests/figma-status.test.js`.
enum FigmaStatusTests {
    static func run() {
        // reports both halves down when the daemon is unreachable
        do {
            let view = toStatusView(nil)
            Checks.expect(view.daemon, .off)
            Checks.expect(view.figma, .off)
            Checks.expect(view.tooltip.contains("connect"), true)
        }

        // The state that otherwise looks like "commands silently do nothing": daemon up, Figma gone.
        do {
            let view = toStatusView(Health(status: "disconnected", mode: "cdp", plugin: false, cdp: false))
            Checks.expect(view.daemon, .ok)
            Checks.expect(view.figma, .off)
        }

        // Either transport counts — Safe Mode talks to the plugin, not CDP.
        do {
            Checks.expect(toStatusView(Health(mode: "plugin", plugin: true, cdp: false)).figma, .ok)
            Checks.expect(toStatusView(Health(mode: "cdp", plugin: false, cdp: true)).figma, .ok)
        }

        // strips the " – Figma" the page title carries
        do {
            Checks.expect(cleanFileName("Designdone – Figma"), "Designdone")
            Checks.expect(cleanFileName("Designdone — Figma"), "Designdone")
            Checks.expect(cleanFileName("Designdone - Figma"), "Designdone")
            Checks.expect(cleanFileName(nil), "")
            // Only at the end, and only as its own word.
            Checks.expect(cleanFileName("Figma Plugin Docs"), "Figma Plugin Docs")
        }

        // names the file in the tooltip when there is one
        do {
            let view = toStatusView(Health(mode: "yolo", cdp: true, file: "Designdone – Figma"))
            Checks.expect(view.file, "Designdone")
            Checks.expect(view.tooltip, "Figma connected (yolo) — Designdone")
        }

        // describeSelection
        do {
            Checks.expect(describeSelection([]), "nothing selected")
            Checks.expect(describeSelection([], page: "Landingpage"), "Landingpage — nothing selected")
            Checks.expect(describeSelection([SelectedNode(id: "1:2", name: "Hero", type: "FRAME")]), "Hero")
            Checks.expect(
                describeSelection([
                    SelectedNode(id: "1:2", name: "Hero", type: "FRAME"),
                    SelectedNode(id: "1:3", name: "Footer", type: "FRAME")
                ]),
                "2 selected: Hero, Footer")
        }

        // Ids are what `get`, `set` and `render --parent` take, so they are never abbreviated away.
        do {
            Checks.expectNil(selectionPromptText([]))
            Checks.expect(
                selectionPromptText([SelectedNode(id: "287:1495", name: "Hero", type: "FRAME")]),
                "Figma selection: \"Hero\" (FRAME 287:1495)")
        }

        // The button names the state instead of the file when there is no file to name.
        do {
            Checks.expect(figmaButtonLabel(daemon: .off, figma: .off, file: "", page: ""), "offline")
            Checks.expect(figmaButtonLabel(daemon: .ok, figma: .off, file: "", page: ""), "not connected")
            Checks.expect(figmaButtonLabel(daemon: .ok, figma: .ok, file: "", page: ""), "no file")
            Checks.expect(figmaButtonLabel(daemon: .ok, figma: .ok, file: "D", page: "Landing"), "D/Landing")
            Checks.expect(figmaButtonLabel(daemon: .ok, figma: .ok, file: "D", page: ""), "D")
        }

        // The three lights the toolbar draws are the menu's three rows — one function for both,
        // so a light and the row above it cannot say different things.
        do {
            let connected = statusRows(figmaRunning: true, cdpOk: true, cdpPort: 9222,
                                       health: Health(mode: "yolo", cdp: true))
            Checks.expect(connected.map(\.state), [.ok, .ok, .ok])

            // Daemon stopped: Figma is still open and the port still answers — only the third
            // light goes out. Two red circles for this state was the fault worth fixing.
            let daemonGone = statusRows(figmaRunning: true, cdpOk: true, cdpPort: 9222, health: nil)
            Checks.expect(daemonGone.map(\.state), [.ok, .ok, .off])
            Checks.expect(daemonGone[2].value, "not running")

            // Figma closed: it is not running, the port is gone with it, the daemon reaches nothing.
            let figmaGone = statusRows(figmaRunning: false, cdpOk: false, cdpPort: 9222,
                                       health: Health(mode: "yolo", cdp: false))
            Checks.expect(figmaGone.map(\.state), [.warn, .off, .warn])

            // Safe Mode: the port is unused rather than broken.
            let safeMode = statusRows(figmaRunning: true, cdpOk: false, cdpPort: 9222,
                                      health: Health(mode: "safe", plugin: true))
            Checks.expect(safeMode.map(\.state), [.ok, .warn, .ok])
            Checks.expect(safeMode[1].value, "unused (plugin)")
        }

        // A change in either of the two probes has to reach the window, so it has to count as a
        // different snapshot — the watcher only reports what changed.
        do {
            var a = FigmaSnapshot.empty
            var b = FigmaSnapshot.empty
            b.figmaRunning = true
            Checks.expect(a == b, false)
            a.figmaRunning = true
            Checks.expect(a == b, true)
            b.cdpOk = true
            Checks.expect(a == b, false)
        }

        // The poll carries both probes into the snapshot rather than answering for the daemon only.
        do {
            let snapshot = pollFigma(healthTimeout: 0.05, evalTimeout: 0.05,
                                     probes: FigmaProbes(figmaRunning: { true },
                                                         cdpReachable: { _ in true }))
            Checks.expect(snapshot.figmaRunning, true)
            Checks.expect(snapshot.cdpOk, true)
        }
    }
}
