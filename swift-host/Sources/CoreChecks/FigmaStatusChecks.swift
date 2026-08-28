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
    }
}
