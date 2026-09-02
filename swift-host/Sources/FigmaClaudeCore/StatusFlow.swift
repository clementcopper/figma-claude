import Foundation

/// Which status items share a line at a given panel width.
///
/// CSS gets this from `flex-wrap`. AppKit has no wrapping stack, so the decision has to be made
/// somewhere — and making it here rather than inside `layout()` is what lets the five widths
/// Daniel measured in Figma (frame `915:6228`) be a test instead of a screenshot comparison.
///
/// Greedy, left to right, exactly as flex-wrap behaves: an item goes on the current line if it
/// still fits, otherwise it opens the next one. No item is ever split, and an item wider than the
/// whole line gets a line of its own rather than disappearing.
public enum StatusFlow {
    /// - Parameters:
    ///   - widths: each item's own width, in order. Ring groups hug their label, so these come
    ///     from measurement at render time — hardcoding them would break the moment a reset time
    ///     is longer than "Sun 1:00 AM".
    ///   - available: the width left for content, padding already taken off.
    ///   - columnGap: space between two items on the same line.
    /// - Returns: one array of item indices per line, in order. Never empty for a non-empty input.
    public static func wrap(widths: [CGFloat], available: CGFloat, columnGap: CGFloat) -> [[Int]] {
        guard !widths.isEmpty else { return [] }

        var rows: [[Int]] = []
        var row: [Int] = []
        var used: CGFloat = 0

        for (index, width) in widths.enumerated() {
            let needed = row.isEmpty ? width : used + columnGap + width
            if row.isEmpty || needed <= available {
                if !row.isEmpty { used += columnGap }
                row.append(index)
                used += width
            } else {
                rows.append(row)
                row = [index]
                used = width
            }
        }
        if !row.isEmpty { rows.append(row) }
        return rows
    }

    /// The width one line of those items needs — what `wrap` compares against.
    public static func lineWidth(widths: [CGFloat], columnGap: CGFloat) -> CGFloat {
        guard !widths.isEmpty else { return 0 }
        return widths.reduce(0, +) + CGFloat(widths.count - 1) * columnGap
    }

    /// Whether the whole row fits on one line, which is when the design centres it.
    ///
    /// Measured rather than guessed at a pixel width: the ring groups hug their labels, so the
    /// point where it stops fitting moves with the content. At the design's default widths it
    /// lands near 398pt — a number to check against, never to branch on.
    public static func fitsOnOneLine(widths: [CGFloat], available: CGFloat, columnGap: CGFloat) -> Bool {
        lineWidth(widths: widths, columnGap: columnGap) <= available
    }
}
