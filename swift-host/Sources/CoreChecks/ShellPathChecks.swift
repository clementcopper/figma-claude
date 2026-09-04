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
