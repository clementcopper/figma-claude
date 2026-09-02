import Foundation
import FigmaClaudeCore

/// The name a panel tab hands to `claude -n`. Grew out of `app/tests/session-name.test.js`, but
/// the two hosts have diverged deliberately: only the Swift host carries the session id in the
/// name, so these cases no longer mirror the JS suite.
enum SessionNameTests {
    static func run() {
    let id = "7f3a1c2d-4b5e-4a6f-8c9d-0e1f2a3b4c5d"

    // testNamesTheSessionAfterTheOpenFigmaFile
    do {
        Checks.expect(panelSessionName(file: "Website Redesign", cwd: "/Users/x/Business",
                                       sessionId: id),
            "fc-website-redesign-7f3a1c2d")
    }

    // Two tabs on one Figma file was the whole bug: same file, same cwd, different session.
    // testTellsTwoTabsOnTheSameFileApart
    do {
        let first = panelSessionName(file: "Designdone", cwd: "/Users/x/Business", sessionId: id)
        let second = panelSessionName(file: "Designdone", cwd: "/Users/x/Business",
                                      sessionId: "c104ab9e-0000-4000-8000-000000000000")
        Checks.expect(first, "fc-designdone-7f3a1c2d")
        Checks.expect(second, "fc-designdone-c104ab9e")
        Checks.expect(first == second, false)
    }

    // The daemon reports the browser page title, so the suffix comes along for the ride.
    // testDropsTheFigmaSuffixThePageTitleCarries
    do {
        Checks.expect(panelSessionName(file: "Icon Set – Figma", sessionId: id),
            "fc-icon-set-7f3a1c2d")
    }

    // A German file name has to stay readable: "Übersicht", not "bersicht".
    // testFoldsDiacriticsInsteadOfDroppingThem
    do {
        Checks.expect(panelSessionName(file: "Übersicht Größen", sessionId: id),
            "fc-ubersicht-grossen-7f3a1c2d")
    }

    // The first tab after app start spawns before the watcher's first poll returns.
    // testFallsBackToTheWorkingDirectory
    do {
        Checks.expect(panelSessionName(file: "", cwd: "/Users/x/Documents/Business", sessionId: id),
            "fc-business-7f3a1c2d")
        Checks.expect(panelSessionName(cwd: "/Users/x/Documents/Business/", sessionId: id),
            "fc-business-7f3a1c2d")
    }

    // testIsThePrefixAndTheIdWhenNeitherIsKnown
    do {
        Checks.expect(panelSessionName(sessionId: id), "fc-7f3a1c2d")
        Checks.expect(panelSessionName(file: nil, cwd: nil, sessionId: id), "fc-7f3a1c2d")
        Checks.expect(panelSessionName(file: "   ", cwd: "", sessionId: id), "fc-7f3a1c2d")
    }

    // testDoesNotNameASessionAfterTheFilesystemRoot
    do {
        Checks.expect(panelSessionName(cwd: "/", sessionId: id), "fc-7f3a1c2d")
        Checks.expect(panelSessionName(cwd: ".", sessionId: id), "fc-7f3a1c2d")
    }

    // Without an id the name is still well formed — the non-Claude and no-name paths reach this.
    // testStaysWellFormedWithoutAnId
    do {
        Checks.expect(panelSessionName(file: "Designdone"), "fc-designdone")
        Checks.expect(panelSessionName(), sessionNamePrefix)
    }

    // Claude Code refuses a name that is empty once invisible characters are stripped, so a file
    // name made only of them has to reach the fallback, not produce "fc--7f3a1c2d".
    // testTreatsAnInvisibleOnlyFileNameAsNoNameAtAll
    do {
        let invisible = "\u{200B}\u{200B}\u{FEFF}"
        Checks.expect(panelSessionName(file: invisible, cwd: "/Users/x/Business", sessionId: id),
            "fc-business-7f3a1c2d")
        Checks.expect(panelSessionName(file: invisible, sessionId: id), "fc-7f3a1c2d")
    }

    // A file name with nothing sluggable in it — CJK, emoji, punctuation — reaches the cwd too.
    // testFallsBackWhenTheSlugComesOutEmpty
    do {
        Checks.expect(panelSessionName(file: "設計 ✱", cwd: "/Users/x/Business", sessionId: id),
            "fc-business-7f3a1c2d")
    }

    // testStripsControlCharacters
    do {
        Checks.expect(panelSessionName(file: "Design\u{0007} System", sessionId: id),
            "fc-design-system-7f3a1c2d")
    }

    // testCollapsesWhitespaceRunsAndNewlines
    do {
        Checks.expect(panelSessionName(file: "Design\n  System", sessionId: id),
            "fc-design-system-7f3a1c2d")
        Checks.expect(sessionSlug("--Design---System--"), "design-system")
    }

    // The cut must not leave a trailing hyphen: `fc-aaa---7f3a1c2d` reads as a broken name.
    // testTruncatesASlugThatWouldBeCutOffAnyway
    do {
        let long = String(repeating: "A", count: 80)
        Checks.expect(panelSessionName(file: long, sessionId: id),
            "fc-" + String(repeating: "a", count: 40) + "-7f3a1c2d")
        let cutAtASpace = String(repeating: "a", count: 39) + " bbbb"
        Checks.expect(sessionSlug(cutAtASpace), String(repeating: "a", count: 39) + "-b")
    }

    // testShortensTheIdToItsFirstBlock
    do {
        Checks.expect(shortSessionId(id), "7f3a1c2d")
        Checks.expect(shortSessionId("7F3A1C2D-4B5E-4A6F-8C9D-0E1F2A3B4C5D"), "7f3a1c2d")
        Checks.expect(shortSessionId(""), "")
        Checks.expect(shortSessionId("  "), "")
    }

    // Only a real start gets a fresh name and id; the other two adopt a session that has both.
    // testKnowsWhichSpawnsStartANewSession
    do {
        Checks.expect(startsANewSession(extraArgs: []), true)
        Checks.expect(startsANewSession(extraArgs: ["--resume"]), false)
        Checks.expect(startsANewSession(extraArgs: ["-r"]), false)
        Checks.expect(startsANewSession(extraArgs: ["--continue"]), false)
        Checks.expect(startsANewSession(extraArgs: ["-c"]), false)
    }
}
}
