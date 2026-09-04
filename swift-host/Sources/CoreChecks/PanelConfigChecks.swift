import Foundation
import FigmaClaudeCore

enum PanelConfigTests {
    static func run() {
    // testMarksTheProcessAsRunningInsideThePanel
    do {
        let env = panelEnvironment(config: PanelConfig(), home: "/Users/x")
        Checks.expect(env["FIGMACLAUDE"], "1")
        Checks.expect(env["TERM"], "xterm-256color")
    }

    // testBindsTheFigmaFileOnlyWhenOneIsConfigured
    do {
        var config = PanelConfig()
        Checks.expectNil(panelEnvironment(config: config, home: "/Users/x")["FIGMA_FILE"])
        config.figmaFile = "Designdone"
        Checks.expect(panelEnvironment(config: config, home: "/Users/x")["FIGMA_FILE"], "Designdone")
    }

    // testAddsTheSessionNameAndIdForClaudeOnly
    do {
        var config = PanelConfig()
        Checks.expect(panelArguments(config: config, sessionName: "fc-x-7f3a1c2d",
                                     sessionId: "7f3a1c2d-4b5e-4a6f-8c9d-0e1f2a3b4c5d"),
                       ["-n", "fc-x-7f3a1c2d",
                        "--session-id", "7f3a1c2d-4b5e-4a6f-8c9d-0e1f2a3b4c5d"])
        config.command = "gemini"
        Checks.expect(panelArguments(config: config, sessionName: "fc-x-7f3a1c2d",
                                     sessionId: "7f3a1c2d-4b5e-4a6f-8c9d-0e1f2a3b4c5d"), [])
    }

    // A resume spawn passes neither, so it adopts the picked session instead of renaming it.
    // testPassesNothingWhenThereIsNoNameAndNoId
    do {
        let config = PanelConfig()
        Checks.expect(panelArguments(config: config, sessionName: ""), [])
    }

    // The status line is per session either way — a resumed tab kept its ring bar only once this
    // stopped hanging off the session name.
    // testHandsOverTheStatusLineEvenWithoutAName
    do {
        let config = PanelConfig()
        let args = panelArguments(config: config, sessionName: "", statusLineCommand: "/bin/true")
        Checks.expect(args.first, "--settings")
        Checks.expect(args.count, 2)
    }

    // testDoesNotClaimAnIdAlongsideResume
    do {
        var config = PanelConfig()
        config.args = ["--resume"]
        Checks.expect(panelArguments(config: config, sessionName: "",
                                     sessionId: "7f3a1c2d-4b5e-4a6f-8c9d-0e1f2a3b4c5d"),
                       ["--resume"])
    }

    // A `-n` the user put in panel.json wins; this only fills a gap.
    // testLeavesAUserSuppliedNameAlone
    do {
        var config = PanelConfig()
        config.args = ["-n", "mine"]
        Checks.expect(panelArguments(config: config, sessionName: "fc-x-7f3a1c2d"), ["-n", "mine"])
    }

    // In autoRun mode the arguments are joined into one shell command, where a name with a space
    // would arrive as two arguments.
    // testStaysOutOfNonDirectMode
    do {
        var config = PanelConfig()
        config.directMode = false
        Checks.expect(panelArguments(config: config, sessionName: "fc-x-7f3a1c2d"), [])
    }
}
}
