import Foundation

/// What each of the four rings shows, derived from one snapshot.
///
/// The old row turned a snapshot into seven labels inside the view. Four rings is more arithmetic,
/// not less — a fill fraction, a level, a number and a caption each — and putting it in the view
/// would make it checkable only by looking at the window. Here it is a function, so the cases that
/// matter (no rate limits yet, a session over its limit, a compaction count past its budget) are
/// `swift run CoreChecks` rather than a screenshot.
public struct StatusRingItem: Equatable {
    public enum Fill: Equatable {
        case fraction(Double)
        /// Lit segments and the budget behind them — the compaction ring counts.
        case segments(lit: Int, budget: Int)
    }

    public let name: String
    public let value: String
    public let sub: String
    public let fill: Fill
    public let level: StatusLevel
    public let tooltip: String
}

/// The threshold the context ring fills against. Set as a number now, not dragged.
public let defaultContextThreshold: Double = 60

/// - Parameters:
///   - snapshot: what Claude Code last wrote.
///   - threshold: the percentage at which the context is considered spent.
/// - Returns: the rings to draw, in order, omitting the ones this snapshot cannot answer for.
///   A missing ring is left out rather than drawn empty: an empty ring reads as "nothing used",
///   which is the opposite of "not known yet".
public func statusRings(_ snapshot: StatusLineSnapshot,
                        threshold: Double = defaultContextThreshold) -> [StatusRingItem] {
    var items: [StatusRingItem] = []

    // Context. The number is the raw percentage and is not capped — a window over its budget
    // should say so — while the arc is, because an arc past full has nowhere to go.
    let budget = threshold > 0 ? threshold : 100
    let ctxFraction = snapshot.usedPercent / budget
    items.append(StatusRingItem(
        name: "Ctx",
        value: "\(Int(snapshot.usedPercent.rounded()))%",
        // No second line. The design measures this group at 57pt, which is the ring plus its gap
        // plus exactly the width of the word "Ctx" — a token count under it made the group 4pt
        // wider and moved the 400pt wrap step. The count lives in the tooltip instead.
        sub: "",
        fill: .fraction(ctxFraction),
        level: RingGeometry.fillLevel(fraction: ctxFraction),
        tooltip: snapshot.totalTokens > 0
            ? "Context: \(snapshot.usedTokens) of \(snapshot.totalTokens) tokens, threshold \(Int(budget))%"
            : "Context: \(Int(snapshot.usedPercent.rounded()))% of the threshold"))

    // Session and week only exist once the account has answered. Claude Code leaves rate limits
    // out until the session has made a request, so this is the normal state of a fresh tab.
    if let session = snapshot.sessionPercent {
        let fraction = session / 100
        var sub = ""
        if let minutes = snapshot.sessionResetsInMin, minutes > 0 {
            sub = formatRemaining(minutes)
        } else if let at = snapshot.sessionResetsAt {
            sub = formatClock(at)
        }
        items.append(StatusRingItem(
            name: "Sess", value: "\(Int(session.rounded()))%", sub: sub,
            fill: .fraction(fraction), level: RingGeometry.fillLevel(fraction: fraction),
            tooltip: "Session limit: \(Int(session.rounded()))% used"))
    }

    if let week = snapshot.weekPercent {
        let fraction = week / 100
        items.append(StatusRingItem(
            name: "Week", value: "\(Int(week.rounded()))%",
            sub: snapshot.weekResetsAt ?? "",
            fill: .fraction(fraction), level: RingGeometry.fillLevel(fraction: fraction),
            tooltip: "Weekly limit: \(Int(week.rounded()))% used"))
    }

    if let compacted = snapshot.compacted {
        let budgetCount = snapshot.compactBudget ?? RingGeometry.compactionDefaultBudget
        let auto = snapshot.compactAuto ?? 0
        items.append(StatusRingItem(
            name: "Comp", value: "\(compacted)",
            sub: budgetCount > 0 ? "of \(budgetCount)" : "",
            fill: .segments(lit: compacted, budget: budgetCount),
            level: RingGeometry.compactionLevel(compacted: compacted),
            tooltip: auto > 0
                ? "\(compacted) compactions, \(auto) automatic"
                : "\(compacted) compactions"))
    }

    return items
}
