import Foundation
import FigmaClaudeCore

/// The detector guesses at somebody else's text, so the cases that matter are the ones where it
/// must stay quiet. A missed prompt costs a dot; a false one teaches the user to ignore the dot.
enum PromptDetectorTests {
    static func run() {
        stripping()
        recognises()
        staysQuiet()
        buffer()
    }

    static func stripping() {
        Checks.expect(stripAnsi("\u{001B}[31mred\u{001B}[0m"), "red")
        Checks.expect(stripAnsi("\u{001B}[?25lhidden\u{001B}[?25h"), "hidden")
        Checks.expect(stripAnsi("plain"), "plain")
        // Colour codes must not hide a prompt from the matcher.
        Checks.expect(looksLikePrompt("\u{001B}[1mContinue?\u{001B}[0m"), true)
    }

    static func recognises() {
        Checks.expect(looksLikePrompt("Do you want to proceed? (y/n)"), true)
        Checks.expect(looksLikePrompt("Overwrite? [Y/n] "), true)
        Checks.expect(looksLikePrompt("Would you like to continue with the plan?"), true)
        Checks.expect(looksLikePrompt("❯ 1. Yes\n  2. No"), true)
        Checks.expect(looksLikePrompt("press enter to confirm"), true)
        Checks.expect(looksLikePrompt("(esc to cancel)"), true)
        Checks.expect(looksLikePrompt("~/.claude/plans/twinkling-leaping-giraffe.md"), true)
    }

    static func staysQuiet() {
        // A normal answer stream is not a question.
        Checks.expect(looksLikePrompt("Ich habe die Datei gelesen und drei Stellen gefunden."), false)
        Checks.expect(looksLikePrompt("Running tests… 166 passed, 0 failed"), false)

        // The expensive false positive: a question quoted mid-paragraph, with the real output
        // continuing after it. Only the tail is inspected, so this must stay quiet.
        let quoted = "The docs ask \"Continue?\" before each step, "
            + String(repeating: "and then describe what happens next. ", count: 12)
        Checks.expect(looksLikePrompt(quoted), false)

        // Same for a y/n that scrolled far above.
        let scrolled = "(y/n)" + String(repeating: "x", count: 300)
        Checks.expect(looksLikePrompt(scrolled), false)

        Checks.expect(looksLikePrompt(""), false)
    }

    static func buffer() {
        // Only the tail is kept: matching against everything Claude ever printed would find a
        // prompt in the transcript rather than at the cursor.
        var buffer = PromptBuffer(maxSize: 10)
        buffer.append("0123456789ABCDE")
        Checks.expect(buffer.text, "56789ABCDE")
        Checks.expect(buffer.text.count, 10)

        buffer.clear()
        Checks.expect(buffer.text, "")
    }
}
