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

/// What the context ring's second line says: the usable window in tokens.
///
/// `1M` when no threshold is set, `400k` when it is at 40% of a 1M window. Empty when the
/// snapshot carries no window size, because a made-up total is worse than no line.
public func contextWindowLabel(_ snapshot: StatusLineSnapshot, threshold: Double) -> String {
    guard snapshot.totalTokens > 0 else { return "" }
    guard threshold > 0, threshold < 100 else { return formatTokens(snapshot.totalTokens) }
    return formatTokens(Int((Double(snapshot.totalTokens) * threshold / 100).rounded()))
}

/// The thresholds the context ring offers when it is clicked.
///
/// Labelled in tokens, because that is what the ring's own second line says and what a context
/// window is actually measured in — a bare "40%" leaves the reader to do the arithmetic against
/// a window size they would have to look up. 100 means no threshold: the full window.
public func contextThresholdChoices(totalTokens: Int) -> [(percent: Double, label: String)] {
    let steps: [Double] = [100, 80, 70, 60, 50, 40, 30, 20]
    return steps.map { percent in
        guard totalTokens > 0 else { return (percent, "\(Int(percent))%") }
        let tokens = formatTokens(Int((Double(totalTokens) * percent / 100).rounded()))
        return (percent, percent >= 100 ? "\(tokens) · full window" : "\(tokens) · \(Int(percent))%")
    }
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

    // Context. The number reads against the same budget the arc fills against, so ring and
    // figure answer one question rather than two: at a 600k threshold, 485k spent is 81% — not
    // the 49% it would be against the whole window, which would make the threshold decorative.
    // Uncapped on purpose: past the threshold it should say 120%, where the arc can only be full.
    let budget = threshold > 0 ? threshold : 100
    let ctxFraction = snapshot.usedPercent / budget
    items.append(StatusRingItem(
        name: "Ctx",
        value: "\(Int((ctxFraction * 100).rounded()))%",
        // The window the ring actually fills against, not how much is spent — that number is
        // already in the middle. Without a threshold it is the whole window (1M); with one it is
        // the slice the threshold leaves (400k at 40%), which is the only place that setting is
        // visible at all now that there is no handle to see.
        // Past the threshold the second line stops naming the budget and names the way out.
        // The toast fires once, on the crossing; this stays until something is done about it,
        // which is the difference between a notification and a state.
        sub: ctxFraction >= 1
            ? "/clear"
            : contextWindowLabel(snapshot, threshold: threshold),
        fill: .fraction(ctxFraction),
        level: RingGeometry.fillLevel(fraction: ctxFraction),
        // Short units, like everywhere else the row names a token count. "254321 of 1000000"
        // is thirteen digits to read where "254k of 1M" is the same fact.
        tooltip: snapshot.totalTokens > 0
            ? "Context: \(formatTokens(snapshot.usedTokens)) of \(formatTokens(snapshot.totalTokens))"
                + (budget < 100 ? ", threshold \(contextWindowLabel(snapshot, threshold: budget))" : "")
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
            // How many of them Claude did on its own. "0 auto" is worth saying rather than
            // hiding: it means every compaction so far was a decision, not a ceiling being hit.
            sub: "\(auto) auto",
            fill: .segments(lit: compacted, budget: budgetCount),
            level: RingGeometry.compactionLevel(compacted: compacted),
            tooltip: auto > 0
                ? "\(compacted) compactions, \(auto) automatic"
                : "\(compacted) compactions"))
    }

    return items
}
