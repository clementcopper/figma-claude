import Foundation
import FigmaClaudeCore

/// Ported from `app/tests/window-bounds.test.js`, `theme-choice.test.js`, `limit-window.test.js`,
/// `pty-exit.test.js`, `render-undo.test.js` and `project-layout.test.js`.
enum PanelPiecesTests {
    static func run() {
        theme()
        bounds()
        limits()
        ptyExit()
        renderUndo()
        aboutAndLayout()
    }

    static func theme() {
        Checks.expect(resolveTheme(setting: .light, systemPrefersDark: true), .light)
        Checks.expect(resolveTheme(setting: .dark, systemPrefersDark: false), .dark)
        Checks.expect(resolveTheme(setting: .system, systemPrefersDark: true), .dark)
        Checks.expect(resolveTheme(setting: .system, systemPrefersDark: false), .light)
        // Anything unrecognised follows macOS rather than picking a side.
        Checks.expect(resolveTheme(setting: nil, systemPrefersDark: true), .dark)
    }

    static func bounds() {
        let screen = [WorkArea(x: 0, y: 0, width: 1680, height: 1050)]

        // Remembered position on an attached screen survives untouched.
        Checks.expect(
            clampBounds(Bounds(x: 100, y: 80, width: 480, height: 720), workAreas: screen),
            Bounds(x: 100, y: 80, width: 480, height: 720))

        // A window parked on a monitor that is gone is pulled back to the primary screen's edge.
        let rescued = clampBounds(Bounds(x: 4000, y: 200, width: 480, height: 720), workAreas: screen)
        Checks.expect(rescued.x, 1200)
        Checks.expect(rescued.y, 0)

        // A sliver on screen is not enough — the title bar has to be grabbable.
        let sliver = clampBounds(Bounds(x: 1660, y: 500, width: 480, height: 720), workAreas: screen)
        Checks.expect(sliver.x, 1200)

        // Below the minimum is raised, and a size with no position stays a size.
        Checks.expect(clampBounds(Bounds(width: 100, height: 100), workAreas: screen),
                      Bounds(width: 320, height: 240))

        // No screens at all: nothing to clamp against, so only the size is honoured.
        Checks.expect(clampBounds(Bounds(x: 10, y: 10, width: 480, height: 720), workAreas: []),
                      Bounds(width: 480, height: 720))

        // A file that is not there, or not JSON, means the defaults rather than a crash.
        Checks.expect(loadBounds(from: "/nope/panel-window.json"), defaultBounds)
    }

    static func limits() {
        let now: Double = 1_000_000_000_000

        // No reset point: a remembered countdown is dropped, because nothing can renew it.
        Checks.expect(applyResetWindow(LimitFields(sessionResetsInMin: 84), now: now).sessionResetsInMin, nil)

        // Still ahead: the minutes are recomputed from the absolute point, not remembered.
        let ahead = applyResetWindow(
            LimitFields(sessionPercent: 42, sessionResetsAt: now / 1000 + 3600), now: now)
        Checks.expect(ahead.sessionResetsInMin, 60)
        Checks.expect(ahead.sessionPercent, 42)

        // Past: percentage and countdown go, but the reset point stays so the UI can say
        // "Limit reset" instead of losing its left half at the moment the waiting is over.
        let past = applyResetWindow(
            LimitFields(sessionPercent: 99, sessionResetsAt: now / 1000 - 60), now: now)
        Checks.expect(past.sessionPercent, nil)
        Checks.expect(past.sessionResetsInMin, nil)
        Checks.expect(past.sessionResetsAt != nil, true)
    }

    static func ptyExit() {
        // The one shape that deserves more than a number.
        let silent = describePtyExit(code: 1, msSinceSpawn: 40, sawOutput: false)
        Checks.expect(silent.contains("reinstalled while running"), true)

        // Anything else is just the code — a hint on a normal exit would be noise.
        Checks.expect(describePtyExit(code: 0, msSinceSpawn: 40, sawOutput: false),
                      "\r\n[Process exited with code 0]\r\n")
        Checks.expect(describePtyExit(code: 1, msSinceSpawn: 5000, sawOutput: false)
            .contains("reinstalled"), false)
        Checks.expect(describePtyExit(code: 1, msSinceSpawn: 40, sawOutput: true)
            .contains("reinstalled"), false)
    }

    static func renderUndo() {
        Checks.expect(parseLastRender(nil).count, 0)
        Checks.expect(parseLastRender("not json").count, 0)
        Checks.expect(parseLastRender("{\"nodes\":\"nope\"}").count, 0)

        let nodes = parseLastRender("{\"nodes\":[{\"id\":\"1:2\",\"name\":\"Hero\"},{\"id\":\"1:3\"}]}")
        Checks.expect(nodes.count, 2)
        Checks.expect(nodes[0], CreatedNode(id: "1:2", name: "Hero"))
        Checks.expect(nodes[1].name, "")

        Checks.expect(undoLabel([]), "Nothing to undo")
        Checks.expect(undoLabel([CreatedNode(id: "1:2", name: "Hero")]), "Undo last render (Hero)")
        Checks.expect(undoLabel([CreatedNode(id: "1:2", name: "")]), "Undo last render (1 node)")
        Checks.expect(undoLabel([CreatedNode(id: "1:2", name: "A"), CreatedNode(id: "1:3", name: "B")]),
                      "Undo last render (2 nodes)")

        Checks.expect(undoMessage(removed: 0, names: []), "Nothing to undo — the nodes are already gone")
        Checks.expect(undoMessage(removed: 2, names: ["Hero", "Footer"]), "Removed Hero, Footer")
        Checks.expect(undoMessage(removed: 2, names: []), "Removed 2 nodes")

        // The ids go in verbatim; nothing is searched for or guessed.
        Checks.expect(buildUndoEval(ids: ["1:2"]).contains("[\"1:2\"]"), true)
    }

    static func aboutAndLayout() {
        Checks.expect(parseCliVersion("2.1.2"), "2.1.2")
        Checks.expect(parseCliVersion("banner line\n2.1.2\n"), "2.1.2")
        Checks.expect(parseCliVersion("figma-cli 2.1.2-beta.1"), "2.1.2-beta.1")
        // A shell error must not be shown as a version.
        Checks.expectNil(parseCliVersion("zsh: command not found: figma-cli"))
        Checks.expectNil(parseCliVersion(""))

        Checks.expect(aboutCredits(cliVersion: nil).hasPrefix("figma-cli —"), true)
        Checks.expect(aboutCredits(cliVersion: "2.1.2").hasPrefix("figma-cli 2.1.2"), true)

        Checks.expect(rulesInstalled("# Using figma-cli\n…"), true)
        Checks.expect(rulesInstalled(""), false)
        Checks.expect(rulesInstalled(nil), false)
        Checks.expect(outputPath("DESIGN.md"), "FigmaClaude/DESIGN.md")
        Checks.expect(outputPath("Sessions", "2026-08-27.md"), "FigmaClaude/Sessions/2026-08-27.md")
    }
}
