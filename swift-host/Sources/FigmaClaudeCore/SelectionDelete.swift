import Foundation

/// Backspace on a mouse selection — an experiment, asked for twice (Daniel, 2026-10-03).
///
/// A terminal selection is a copy selection in the character grid, not an editor state; no
/// terminal deletes it with ⌫. Claude Code's prompt is a line editor, though, so the host can
/// act one out: move the cursor left to the end of the selection, then send one ⌫ per selected
/// character. SwiftTerm turns the selection off as the first thing in `keyDown`, but `start`,
/// `end` and the text survive, and `selectionChanged` tells the host the moment it went off.
///
/// Known edges, by design: one row only, the cursor's row (buffer coordinates), the selection
/// ending at or before the cursor; counts are characters, columns are cells, so a wide glyph
/// (emoji) inside the selection makes one ⌫ too many. Triple-click takes the prompt's `> ` with
/// it — Claude Code stops at an empty line, nothing worse.
public struct SelectionSnapshot: Equatable {
    public let startCol: Int
    public let endCol: Int
    public let startRow: Int
    public let endRow: Int
    public let text: String

    public init(startCol: Int, endCol: Int, startRow: Int, endRow: Int, text: String) {
        self.startCol = startCol
        self.endCol = endCol
        self.startRow = startRow
        self.endRow = endRow
        self.text = text
    }
}

public struct SelectionDeletePlan: Equatable {
    public let lefts: Int
    public let backspaces: Int
    public init(lefts: Int, backspaces: Int) { self.lefts = lefts; self.backspaces = backspaces }
}

/// How long after the selection went off a ⌫ still counts as "delete the selection": `keyDown`
/// turns it off microseconds before `send` sees the byte, and a user who clicked elsewhere a
/// second ago means the plain ⌫.
public let selectionDeleteWindow: TimeInterval = 0.3

/// - cursorCol/cursorRow: the terminal cursor in the same (buffer) coordinates as the selection
/// - releasedAt: when `selectionChanged` last saw the selection go inactive; nil = still active
///   or never selected
public func selectionDeletePlan(_ sel: SelectionSnapshot?, cursorCol: Int, cursorRow: Int,
                                now: Date, releasedAt: Date?) -> SelectionDeletePlan? {
    guard let sel, let releasedAt, now.timeIntervalSince(releasedAt) < selectionDeleteWindow else { return nil }
    let text = sel.text.replacingOccurrences(of: "\n", with: "")
    guard !text.isEmpty else { return nil }
    let (lo, hi) = sel.startCol <= sel.endCol ? (sel.startCol, sel.endCol) : (sel.endCol, sel.startCol)
    guard sel.startRow == sel.endRow, sel.startRow == cursorRow else { return nil }
    let selectionEnd = max(hi, lo + text.count)   // whichever convention `end` follows
    guard selectionEnd <= cursorCol else { return nil }
    return SelectionDeletePlan(lefts: cursorCol - selectionEnd, backspaces: text.count)
}

/// The bytes for a plan: `ESC[D` per step left, DEL per character.
public func selectionDeleteBytes(_ plan: SelectionDeletePlan) -> [UInt8] {
    var out: [UInt8] = []
    for _ in 0..<plan.lefts { out += [0x1b, 0x5b, 0x44] }
    for _ in 0..<plan.backspaces { out.append(0x7f) }
    return out
}
