import Foundation

/// The four status rings, as angles rather than as drawing.
///
/// The web host builds them as an SVG `<circle>` with `stroke-dasharray` and a rotation; AppKit
/// has no dash offset to lean on, so the same design has to arrive here as explicit start and end
/// angles. Keeping that arithmetic out of the view is what lets `swift run CoreChecks` prove the
/// ring against Daniel's measured Figma frames without opening a window.
///
/// Every number below was measured out of the design (Section `936:2`, page *claude-terminal-panel*),
/// not chosen here: a 36-point box, a 300° sweep starting at 120° clockwise, round caps.
public enum RingGeometry {
    /// The box the ring is drawn in, and the centre it turns around.
    public static let boxSize: CGFloat = 36
    public static var center: CGPoint { CGPoint(x: boxSize / 2, y: boxSize / 2) }

    /// Mid-stroke radius: the arc is stroked, so this is the centre line of the band, not its edge.
    public static let radius: CGFloat = 16.38
    public static let strokeWidth: CGFloat = 3.24

    /// Where the track begins and how far it runs. 120° puts the gap at the bottom, centred.
    public static let startDegrees: CGFloat = 120
    public static let spanDegrees: CGFloat = 300

    /// The compaction ring counts instead of filling: one segment per budgeted compaction.
    public static let compactionGapDegrees: CGFloat = 21
    public static let compactionDefaultBudget = 3
    /// Three, and not more.
    ///
    /// The reference caps at 5 and justifies it with "past this the segments are thinner than
    /// their own round caps" — which does not hold: at this radius a cap is 5.67°, and a segment
    /// only shrinks to its own stroke width at **ten** of them. At five it is still 12.3pt long
    /// against 3.24pt thick. The cap was more conservative than its stated reason, the same way
    /// its "first third" comment outlived the 0.6/0.8 constants above it.
    ///
    /// Three is about reading, not geometry: the ring exists so the count can be taken in without
    /// counting, and three is what that supports. It is also the default budget. A larger budget
    /// still renders — as three segments, with the true number in the middle.
    public static let compactionMaxSegments = 3

    /// The arc a fraction fills, clockwise from `startDegrees`.
    ///
    /// The fraction is clamped, not wrapped: a session over its limit reports more than 100% and
    /// must show a full ring, never an arc that has gone round and looks nearly empty again.
    public static func fillArc(fraction: Double) -> (start: CGFloat, end: CGFloat) {
        let clamped = CGFloat(min(1, max(0, fraction)))
        return (startDegrees, startDegrees + spanDegrees * clamped)
    }

    /// The compaction ring's segments: `budget` of them sharing the span, minus the gaps between.
    ///
    /// Measured in the design at a budget of 3: segments of 86° with 21° gaps, starting at
    /// 120 / 227 / 334. That falls out of the arithmetic rather than being hardcoded, so a budget
    /// of 4 or 5 keeps the same gap and shrinks the segments.
    public static func compactionSegments(budget: Int) -> [(start: CGFloat, end: CGFloat)] {
        let count = max(1, min(compactionMaxSegments, budget))
        let gaps = CGFloat(count - 1) * compactionGapDegrees
        let segment = (spanDegrees - gaps) / CGFloat(count)
        guard segment > 0 else { return [] }
        return (0..<count).map { index in
            let start = startDegrees + CGFloat(index) * (segment + compactionGapDegrees)
            return (start, start + segment)
        }
    }

    /// Where a filling ring turns. Measured on the **fill**, not on the raw percentage: the
    /// context ring fills against the user's threshold, so these are fractions of that budget
    /// rather than of a full window.
    ///
    /// Not thirds. The reference still carries a doc comment saying "first third blue, second
    /// orange, last red" above constants that read 0.6 and 0.8 — the rule was changed and the
    /// prose was not. The constants are the truth.
    public static let fillWarnFraction = 0.6
    public static let fillDangerFraction = 0.8

    public static func fillLevel(fraction: Double) -> StatusLevel {
        if fraction >= fillDangerFraction { return .danger }
        if fraction >= fillWarnFraction { return .warn }
        return .normal
    }

    /// Counting, not filling: the second compaction warns and the third is red, because a session
    /// that has compacted three times has lost more context than a percentage conveys.
    ///
    /// The thresholds are absolute, not shares of the budget — a second compaction is a second
    /// compaction whether the budget is 3 or 5. Written budget-relative first, which agreed at the
    /// default budget of 3 and quietly disagreed everywhere else; the reference implementation
    /// settled it.
    public static let compactionWarnAt = 2
    public static let compactionDangerAt = 3

    public static func compactionLevel(compacted: Int) -> StatusLevel {
        if compacted >= compactionDangerAt { return .danger }
        if compacted >= compactionWarnAt { return .warn }
        return .normal
    }
}
