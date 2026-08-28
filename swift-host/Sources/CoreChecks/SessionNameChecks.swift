import Foundation
import FigmaClaudeCore

/// Ported from `app/tests/session-name.test.js` — same cases, same expectations, so a difference
/// between the two hosts shows up as a failing test rather than as a differently named session.
enum SessionNameTests {
    static func run() {
    // testNamesTheSessionAfterTheOpenFigmaFile
    do {
        Checks.expect(panelSessionName(file: "Website Redesign", cwd: "/Users/x/Business"),
            "figma-claude:Website Redesign")
    }

    // The daemon reports the browser page title, so the suffix comes along for the ride.
    // testDropsTheFigmaSuffixThePageTitleCarries
    do {
        Checks.expect(panelSessionName(file: "Icon Set – Figma"), "figma-claude:Icon Set")
    }

    // The first tab after app start spawns before the watcher's first poll returns.
    // testFallsBackToTheWorkingDirectory
    do {
        Checks.expect(panelSessionName(file: "", cwd: "/Users/x/Documents/Business"),
            "figma-claude:Business")
        Checks.expect(panelSessionName(cwd: "/Users/x/Documents/Business/"),
            "figma-claude:Business")
    }

    // testIsTheBarePrefixWhenNeitherIsKnown
    do {
        Checks.expect(panelSessionName(), sessionNamePrefix)
        Checks.expect(panelSessionName(file: nil, cwd: nil), sessionNamePrefix)
        Checks.expect(panelSessionName(file: "   ", cwd: ""), sessionNamePrefix)
    }

    // testDoesNotNameASessionAfterTheFilesystemRoot
    do {
        Checks.expect(panelSessionName(cwd: "/"), sessionNamePrefix)
    }

    // Claude Code refuses a name that is empty once invisible characters are stripped, so a file
    // name made only of them has to reach the fallback, not produce "figma-claude:".
    // testTreatsAnInvisibleOnlyFileNameAsNoNameAtAll
    do {
        let invisible = "\u{200B}\u{200B}\u{FEFF}"
        Checks.expect(panelSessionName(file: invisible, cwd: "/Users/x/Business"),
            "figma-claude:Business")
        Checks.expect(panelSessionName(file: invisible), sessionNamePrefix)
    }

    // testStripsControlCharacters
    do {
        Checks.expect(panelSessionName(file: "Design\u{0007} System"), "figma-claude:Design System")
    }

    // testCollapsesWhitespaceRunsAndNewlines
    do {
        Checks.expect(panelSessionName(file: "Design\n  System"), "figma-claude:Design System")
    }

    // testTruncatesASuffixThatWouldBeCutOffAnyway
    do {
        let long = String(repeating: "A", count: 80)
        Checks.expect(panelSessionName(file: long), "figma-claude:" + String(repeating: "A", count: 40))
    }
}
}
