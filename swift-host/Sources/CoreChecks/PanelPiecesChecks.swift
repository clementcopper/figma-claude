import Foundation
import FigmaClaudeCore

/// Ported from `app/tests/window-bounds.test.js`, `theme-choice.test.js`, `limit-window.test.js`,
/// `pty-exit.test.js`, `render-undo.test.js` and `project-layout.test.js`.
enum PanelPiecesTests {
    static func run() {
        toolbarFit()
        theme()
        bounds()
        limits()
        ptyExit()
        renderUndo()
        aboutAndLayout()
        outputFolder()
    }

    /// How the top bar gives way. The buttons keep their places; the text inside them is what
    /// adapts, and in a fixed order.
    static func toolbarFit() {
        // Room for both: nothing is shortened.
        Checks.expect(toolbarLabelBudgets(available: 200, cwdWanted: 50, figmaWanted: 90,
                                          cwdGap: 5, figmaGap: 5),
                      LabelBudgets(cwd: 50, figma: 90))

        // Tight: the Figma name gives way first — the lights beside it already carry the state.
        Checks.expect(toolbarLabelBudgets(available: 110, cwdWanted: 50, figmaWanted: 90,
                                          cwdGap: 5, figmaGap: 5),
                      LabelBudgets(cwd: 50, figma: 50))

        // Below the floor the Figma label is dropped rather than left as a letter and an ellipsis —
        // and its gap comes back to the folder name, which is why this is one function and not two.
        Checks.expect(toolbarLabelBudgets(available: 85, cwdWanted: 50, figmaWanted: 90,
                                          cwdGap: 5, figmaGap: 5),
                      LabelBudgets(cwd: 50, figma: 0))
        Checks.expect(toolbarLabelBudgets(available: 45, cwdWanted: 50, figmaWanted: 90,
                                          cwdGap: 5, figmaGap: 5),
                      LabelBudgets(cwd: 40, figma: 0))

        // The narrowest the window goes: the folder name is squeezed, not removed. It used to be
        // dropped here too, and the row then said nothing about where you were.
        Checks.expect(toolbarLabelBudgets(available: 34, cwdWanted: 50, figmaWanted: 90,
                                          cwdGap: 5, figmaGap: 5),
                      LabelBudgets(cwd: 29, figma: 0))
        // Nothing left to hand out is arithmetic, not a decision.
        Checks.expect(toolbarLabelBudgets(available: -20, cwdWanted: 50, figmaWanted: 90),
                      LabelBudgets(cwd: 0, figma: 0))

        // The floor is the Figma label's alone now. The folder name keeps whatever is left.
        Checks.expect(toolbarLabelBudgets(available: minimumLabelWidth, cwdWanted: 50,
                                          figmaWanted: 90).cwd, minimumLabelWidth)
        Checks.expect(toolbarLabelBudgets(available: minimumLabelWidth - 1, cwdWanted: 50,
                                          figmaWanted: 90).cwd, minimumLabelWidth - 1)

        // The promise itself, across the range rather than at three points: as long as there is
        // room for anything at all, the folder name has some of it.
        let dropped = stride(from: 6.0, through: 200.0, by: 1.0).filter { available in
            toolbarLabelBudgets(available: available, cwdWanted: 50, figmaWanted: 90,
                                cwdGap: 5, figmaGap: 5).cwd <= 0
        }
        Checks.expect(dropped.count, 0)
        // A label never gets more than it asked for, however much room there is.
        Checks.expect(toolbarLabelBudgets(available: 4000, cwdWanted: 50, figmaWanted: 90),
                      LabelBudgets(cwd: 50, figma: 90))
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

        // A command that is not there names itself and the file to fix, as a terminal line.
        let missing = missingCommandNote(command: "claude", configPath: "/Users/x/panel.json")
        Checks.expect(missing.hasPrefix("\r\n[claude is not on the PATH"), true)
        Checks.expect(missing.contains("/Users/x/panel.json"), true)
        Checks.expect(missing.hasSuffix("]\r\n"), true)

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

        Checks.expect(aboutCredits(cliVersion: nil), "figma-cli —")
        Checks.expect(aboutCredits(cliVersion: "2.1.2"), "figma-cli 2.1.2")
        Checks.expect(aboutCredits(cliVersion: "2.1.2", buildDate: "2026-09-02"),
                      "figma-cli 2.1.2\nBuilt 2026-09-02")
        // A bundle built without git has no date to show, and an empty line would look broken.
        Checks.expect(aboutCredits(cliVersion: "2.1.2", buildDate: ""), "figma-cli 2.1.2")

        // The build goes in the About panel's parentheses; nothing usable means no parentheses.
        Checks.expect(aboutBuild(commit: "8ce6ba5"), "8ce6ba5")
        Checks.expect(aboutBuild(commit: "8ce6ba5+"), "8ce6ba5+")
        Checks.expect(aboutBuild(commit: nil), "")
        Checks.expect(aboutBuild(commit: ""), "")
        Checks.expect(aboutBuild(commit: "unknown"), "")

        Checks.expect(rulesInstalled("# Using figma-cli\n…"), true)
        Checks.expect(rulesInstalled(""), false)
        Checks.expect(rulesInstalled(nil), false)
        Checks.expect(outputPath("DESIGN.md"), "Figma Claude/DESIGN.md")
        Checks.expect(outputPath("Sessions", "2026-08-27.md"), "Figma Claude/Sessions/2026-08-27.md")

        // The path the panel writes and the path the SessionStart hook reads have to be the same
        // string. They were not: the skill wrote "Figma Claude/Sessions/HANDOFF.md" and the hook
        // looked for "FigmaClaude/Sessions/HANDOFF.md", so a panel handoff was written and never
        // read. Nothing enforced it, because nothing compared them.
        Checks.expect(outputPath("Sessions", "HANDOFF.md"), handoffPathForHook)
        // And the name itself, spelled out once, so a rename has to pass through here.
        Checks.expect(outputDir, "Figma Claude")
    }

    /// The folder the "Prepare this folder" button creates, run against a real directory.
    static func outputFolder() {
        let root = NSTemporaryDirectory() + "figmaclaude-prepare-\(UUID().uuidString)"
        try? FileManager.default.createDirectory(atPath: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: root) }

        let sessions = root + "/Figma Claude/Sessions"
        let readme = root + "/Figma Claude/README.md"

        Checks.expect(prepareOutputFolder(cwd: root).contains("ready"), true)
        Checks.expect(FileManager.default.fileExists(atPath: sessions), true)
        Checks.expect(FileManager.default.fileExists(atPath: readme), true)

        // Pressing it twice must change nothing. A project that has been used holds a handoff and
        // a DESIGN.md in here; overwriting either would destroy exactly what the folder is for.
        try? "kept".write(toFile: sessions + "/HANDOFF.md", atomically: true, encoding: .utf8)
        try? "mine".write(toFile: readme, atomically: true, encoding: .utf8)
        _ = prepareOutputFolder(cwd: root)
        Checks.expect(try? String(contentsOfFile: sessions + "/HANDOFF.md", encoding: .utf8), "kept")
        Checks.expect(try? String(contentsOfFile: readme, encoding: .utf8), "mine")

        // The README says who wrote the folder — it appears in someone's project uninvited.
        try? FileManager.default.removeItem(atPath: readme)
        _ = prepareOutputFolder(cwd: root)
        let text = (try? String(contentsOfFile: readme, encoding: .utf8)) ?? ""
        Checks.expect(text.contains("HANDOFF.md"), true)
        Checks.expect(text.contains("figma-cli"), true)
    }
}
