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
            // Yolo/Browser keep three dots: Figma, CDP (the port), Daemon.
            let connected = statusRows(figmaRunning: true, cdpOk: true, cdpPort: 9222,
                                       health: Health(mode: "yolo", cdp: true), mode: .yolo)
            Checks.expect(connected.map(\.label), ["Figma", "CDP", "Daemon"])
            Checks.expect(connected.map(\.state), [.ok, .ok, .ok])
            Checks.expect(connected[2].value, "yolo")

            // Daemon stopped: Figma is still open and the port still answers — only the third
            // light goes out. Two red circles for this state was the fault worth fixing.
            let daemonGone = statusRows(figmaRunning: true, cdpOk: true, cdpPort: 9222, health: nil, mode: .yolo)
            Checks.expect(daemonGone.map(\.state), [.ok, .ok, .off])
            Checks.expect(daemonGone[2].value, "not running")

            // Figma closed: it is not running, the port is gone with it, the daemon reaches nothing.
            let figmaGone = statusRows(figmaRunning: false, cdpOk: false, cdpPort: 9222,
                                       health: Health(mode: "yolo", cdp: false), mode: .yolo)
            Checks.expect(figmaGone.map(\.state), [.warn, .off, .warn])

            // Safe Mode: no port, so only two dots — Figma and Daemon. The Daemon row carries the
            // transport and the connection: plugin connected is a working link.
            let safeMode = statusRows(figmaRunning: true, cdpOk: false, cdpPort: 9222,
                                      health: Health(mode: "safe", plugin: true), mode: .safe)
            Checks.expect(safeMode.map(\.label), ["Figma", "Daemon"])
            Checks.expect(safeMode.map(\.state), [.ok, .ok])
            Checks.expect(safeMode[1].value, "safe")

            // Safe Mode, plugin not started yet: the daemon is up but waiting.
            let safeWaiting = statusRows(figmaRunning: true, cdpOk: false, cdpPort: 9222,
                                         health: Health(mode: "safe", plugin: false), mode: .safe)
            Checks.expect(safeWaiting.map(\.label), ["Figma", "Daemon"])
            Checks.expect(safeWaiting[1].state, .warn)
            Checks.expect(safeWaiting[1].value, "safe, waiting for plugin")

            // Pipe Mode, document still loading: the daemon holds the pipe (pipe:true) but cdp is
            // not yet true. Two dots; the Daemon row says connecting, not a fault.
            let pipeLoading = statusRows(figmaRunning: true, cdpOk: false, cdpPort: 9222,
                                         health: Health(mode: "pipe", cdp: false, pipe: true), mode: .pipe)
            Checks.expect(pipeLoading.map(\.label), ["Figma", "Daemon"])
            Checks.expect(pipeLoading[1].state, .warn)
            Checks.expect(pipeLoading[1].value, "pipe, connecting…")

            // Pipe connected: cdp true once the design context attached. Two dots, both green.
            let pipeUp = statusRows(figmaRunning: true, cdpOk: true, cdpPort: 9222,
                                    health: Health(mode: "pipe", cdp: true, pipe: true), mode: .pipe)
            Checks.expect(pipeUp.map(\.label), ["Figma", "Daemon"])
            Checks.expect(pipeUp.map(\.state), [.ok, .ok])
            Checks.expect(pipeUp[1].value, "pipe")
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
