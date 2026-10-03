import Foundation
import FigmaClaudeCore

enum SelectionDeleteTests {
    static func run() {
        plans()
        bytes()
        kittyFilter()
    }

    static func plans() {
        let now = Date()
        let justNow = now.addingTimeInterval(-0.05)
        let word = SelectionSnapshot(startCol: 4, endCol: 8, startRow: 20, endRow: 20, text: "zwei")
        // "> ein zwei drei|" — cursor at col 14, the word "zwei" ends at col 8: 6 left, 4 back.
        Checks.expect(selectionDeletePlan(word, cursorCol: 14, cursorRow: 20, now: now, releasedAt: justNow),
                      SelectionDeletePlan(lefts: 6, backspaces: 4))
        // Selection ends at the cursor: no lefts.
        Checks.expect(selectionDeletePlan(word, cursorCol: 8, cursorRow: 20, now: now, releasedAt: justNow),
                      SelectionDeletePlan(lefts: 0, backspaces: 4))
        // Reversed start/end (dragged leftwards) is the same selection.
        let reversed = SelectionSnapshot(startCol: 8, endCol: 4, startRow: 20, endRow: 20, text: "zwei")
        Checks.expect(selectionDeletePlan(reversed, cursorCol: 14, cursorRow: 20, now: now, releasedAt: justNow),
                      SelectionDeletePlan(lefts: 6, backspaces: 4))
        // `end` exclusive or inclusive: the text length decides, never the column arithmetic alone.
        let inclusive = SelectionSnapshot(startCol: 4, endCol: 7, startRow: 20, endRow: 20, text: "zwei")
        Checks.expect(selectionDeletePlan(inclusive, cursorCol: 14, cursorRow: 20, now: now, releasedAt: justNow),
                      SelectionDeletePlan(lefts: 6, backspaces: 4))
        // Not the cursor's row, two rows, after the cursor, stale, empty, still active: plain ⌫.
        Checks.expectNil(selectionDeletePlan(word, cursorCol: 14, cursorRow: 19, now: now, releasedAt: justNow))
        let twoRows = SelectionSnapshot(startCol: 4, endCol: 8, startRow: 19, endRow: 20, text: "a\nb")
        Checks.expectNil(selectionDeletePlan(twoRows, cursorCol: 14, cursorRow: 20, now: now, releasedAt: justNow))
        Checks.expectNil(selectionDeletePlan(word, cursorCol: 6, cursorRow: 20, now: now, releasedAt: justNow))
        Checks.expectNil(selectionDeletePlan(word, cursorCol: 14, cursorRow: 20, now: now, releasedAt: now.addingTimeInterval(-2)))
        let empty = SelectionSnapshot(startCol: 4, endCol: 4, startRow: 20, endRow: 20, text: "")
        Checks.expectNil(selectionDeletePlan(empty, cursorCol: 14, cursorRow: 20, now: now, releasedAt: justNow))
        Checks.expectNil(selectionDeletePlan(word, cursorCol: 14, cursorRow: 20, now: now, releasedAt: nil))
        Checks.expectNil(selectionDeletePlan(nil, cursorCol: 14, cursorRow: 20, now: now, releasedAt: justNow))
    }

    static func bytes() {
        Checks.expect(selectionDeleteBytes(SelectionDeletePlan(lefts: 2, backspaces: 3)),
                      [0x1b, 0x5b, 0x44, 0x1b, 0x5b, 0x44, 0x7f, 0x7f, 0x7f])
        Checks.expect(selectionDeleteBytes(SelectionDeletePlan(lefts: 0, backspaces: 1)), [0x7f])
    }

    static func kittyFilter() {
        var st = KittyFilterState()
        let esc: UInt8 = 0x1b
        // The four forms go, everything around them stays.
        let a = Array("x\u{1b}[?u\u{1b}[>1u\u{1b}[=1;1u\u{1b}[<uy".utf8)
        Checks.expect(stripKittyNegotiation(a, state: &st), Array("xy".utf8))
        Checks.expect(st.carry, [])
        // Other private CSIs (cursor hide, bracketed paste) are untouched.
        let b = Array("\u{1b}[?25l\u{1b}[?2004h\u{1b}[38;5;2m".utf8)
        Checks.expect(stripKittyNegotiation(b, state: &st), b)
        // Split across two reads: "ESC[" then ">1u".
        Checks.expect(stripKittyNegotiation([0x61, esc, 0x5b], state: &st), [0x61])
        Checks.expect(st.carry, [esc, 0x5b])
        Checks.expect(stripKittyNegotiation(Array(">1ub".utf8), state: &st), Array("b".utf8))
        Checks.expect(st.carry, [])
        // Split after the lead and digits: "ESC[>" then "1u"; and a lone ESC at the end.
        Checks.expect(stripKittyNegotiation(Array("\u{1b}[>".utf8), state: &st), [])
        Checks.expect(stripKittyNegotiation(Array("1u".utf8), state: &st), [])
        Checks.expect(stripKittyNegotiation([0x62, esc], state: &st), [0x62])
        Checks.expect(stripKittyNegotiation(Array("[?25h".utf8), state: &st), Array("\u{1b}[?25h".utf8))
    }
}
