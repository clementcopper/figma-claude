import Foundation
import FigmaClaudeCore

/// Ported from `app/tests/shell-path.test.js` and the `pathWithShim` cases in `cli-shim.test.js`.
enum ShellPathTests {
    static func run() {
    // testExtractsThePathFromBehindABanner
    do {
        let stdout = """
        Last login: whenever
        some version notice
        \(pathMarker)/usr/bin:/bin
        """
        Checks.expect(extractProbedPath(stdout), "/usr/bin:/bin")
    }

    // An interactive shell may print a prompt after the answer, so the LAST marker line wins.
    // testTakesTheLastMarkerLine
    do {
        let stdout = "\(pathMarker)/wrong\n\(pathMarker)/usr/bin:/bin\n$ "
        Checks.expect(extractProbedPath(stdout), "/usr/bin:/bin")
    }

    // testRejectsAnAnswerThatIsNotAPath
    do {
        Checks.expectNil(extractProbedPath("\(pathMarker)\n"))
        Checks.expectNil(extractProbedPath("no marker here"))
    }

    // testAppendsUserBinDirsWithoutDisturbingTheShellsOrder
    do {
        let result = withUserBinDirs("/usr/bin:/bin", home: "/Users/x")
        Checks.expect(result, "/usr/bin:/bin:/Users/x/.local/bin:/opt/homebrew/bin:/usr/local/bin")
    }

    // testDoesNotDuplicateADirTheShellAlreadyNamed
    do {
        let result = withUserBinDirs("/opt/homebrew/bin:/usr/bin", home: "/Users/x")
        Checks.expect(result.components(separatedBy: "/opt/homebrew/bin").count - 1, 1)
    }

    // testPutsTheShimFirstWithoutDuplicatingItOnASecondStart
    do {
        let once = pathWithShim("/usr/bin:/bin", dir: "/shim")
        Checks.expect(once, "/shim:/usr/bin:/bin")
        Checks.expect(pathWithShim(once, dir: "/shim"), once)
    }

    // testMovesTheShimToTheFrontIfItSatElsewhere
    do {
        Checks.expect(pathWithShim("/usr/bin:/shim:/bin", dir: "/shim"), "/shim:/usr/bin:/bin")
    }

    // testWhichFindsACommandAndReportsAMissingOne
    do {
        let present: Set<String> = ["/usr/bin/claude"]
        let exists: (String) -> Bool = { present.contains($0) }
        Checks.expect(whichOnPath("claude", path: "/bin:/usr/bin", exists: exists), "/usr/bin/claude")
        Checks.expectNil(whichOnPath("gemini", path: "/bin:/usr/bin", exists: exists))
    }

    // Already a path: the shell would not search for it either.
    // testWhichDoesNotSearchForAnAbsolutePath
    do {
        Checks.expectNil(whichOnPath("/nope/claude", path: "/usr/bin", exists: { _ in false }))
        Checks.expect(whichOnPath("/yes/claude", path: "/usr/bin", exists: { $0 == "/yes/claude" }), "/yes/claude")
    }
}

}

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
