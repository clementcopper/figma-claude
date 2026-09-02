import Foundation
import FigmaClaudeCore

/// The ring design and its wrap steps, measured out of Daniel's Figma frames rather than agreed
/// on in prose. Frame `915:6228` carries the five panel widths; the ring numbers come from the
/// path endpoints of `915:5234`.
enum StatusRingTests {
    static func run() {
        ringArcs()
        fillLevels()
        compactionRing()
        wrapSteps()
        wrapEdges()
        ringModel()
        contextWindow()
        weekReset()
        weekResetLegacy()
        thresholdNotice()
    }

    static func ringArcs() {
        // A full ring is the whole 300° sweep; an empty one is a point at the start.
        let full = RingGeometry.fillArc(fraction: 1)
        Checks.expect(full.start, 120)
        Checks.expect(full.end, 420)

        let empty = RingGeometry.fillArc(fraction: 0)
        Checks.expect(empty.end, 120)

        // The design's own example: 53% of the context ring measures 160°.
        let ctx = RingGeometry.fillArc(fraction: 0.53)
        Checks.expect((ctx.end - ctx.start).rounded(), 159)

        // Over the limit must read as full, not wrap round to nearly empty.
        Checks.expect(RingGeometry.fillArc(fraction: 1.4).end, 420)
        Checks.expect(RingGeometry.fillArc(fraction: -1).end, 120)
    }

    static func fillLevels() {
        // 0.6 and 0.8 of the fill, not thirds — the reference's own doc comment says thirds above
        // constants that say 0.6/0.8, and the constants are what ships.
        Checks.expect(RingGeometry.fillLevel(fraction: 0.0), StatusLevel.normal)
        Checks.expect(RingGeometry.fillLevel(fraction: 0.59), StatusLevel.normal)
        Checks.expect(RingGeometry.fillLevel(fraction: 0.6), StatusLevel.warn)
        Checks.expect(RingGeometry.fillLevel(fraction: 0.79), StatusLevel.warn)
        Checks.expect(RingGeometry.fillLevel(fraction: 0.8), StatusLevel.danger)
        Checks.expect(RingGeometry.fillLevel(fraction: 2.0), StatusLevel.danger)
        // A third would have made 0.4 warn. It must not.
        Checks.expect(RingGeometry.fillLevel(fraction: 0.4), StatusLevel.normal)
    }

    static func compactionRing() {
        // Measured in the design at budget 3: 86° segments, 21° gaps, starts 120 / 227 / 334.
        let three = RingGeometry.compactionSegments(budget: 3)
        Checks.expect(three.count, 3)
        Checks.expect(three[0].start, 120)
        Checks.expect((three[0].end - three[0].start).rounded(), 86)
        Checks.expect(three[1].start.rounded(), 227)
        Checks.expect(three[2].start.rounded(), 334)

        // Two segments share the same span with one gap — the arithmetic is not pinned to 3.
        let two = RingGeometry.compactionSegments(budget: 2)
        Checks.expect(two.count, 2)
        Checks.expect(two.last!.end.rounded(), 420)
        Checks.expect((two[0].end - two[0].start).rounded(), 140)

        // A larger budget is capped at three segments rather than drawn thinner. The number in
        // the middle still carries the true count, so only the bar chart of it is lost.
        Checks.expect(RingGeometry.compactionSegments(budget: 5).count, 3)
        Checks.expect(RingGeometry.compactionSegments(budget: 99).count, 3)
        Checks.expect(RingGeometry.compactionSegments(budget: 0).count, 1)

        // Counting, not filling — and the thresholds are absolute. A budget-relative version
        // agreed at the default 3 and disagreed at 5, which is exactly the kind of divergence a
        // test at one budget would never have shown.
        Checks.expect(RingGeometry.compactionLevel(compacted: 0), StatusLevel.normal)
        Checks.expect(RingGeometry.compactionLevel(compacted: 1), StatusLevel.normal)
        Checks.expect(RingGeometry.compactionLevel(compacted: 2), StatusLevel.warn)
        Checks.expect(RingGeometry.compactionLevel(compacted: 3), StatusLevel.danger)
        Checks.expect(RingGeometry.compactionLevel(compacted: 9), StatusLevel.danger)
        // Past the budget the ring stays red rather than resetting or overflowing — after three
        // compactions Daniel usually clears, so this is the edge, not the normal reading.
        Checks.expect(RingGeometry.compactionLevel(compacted: 4), StatusLevel.danger)
        Checks.expect(RingGeometry.compactionLevel(compacted: 12), StatusLevel.danger)
        // And there are never more segments than three to light.
        Checks.expect(RingGeometry.compactionSegments(budget: 3).count, 3)

        // The case that caught it: two compactions warn whatever the budget.
        Checks.expect(RingGeometry.compactionLevel(compacted: 2), StatusLevel.warn)
    }

    /// The five widths in frame `915:6228`, against the item widths the design reports:
    /// head 79, ctx 57, sess 64, week 86, comp 64, at the new 8pt column gap and 16pt padding.
    static func wrapSteps() {
        let widths: [CGFloat] = [79, 57, 64, 86, 64]
        let gap: CGFloat = 8
        let padding: CGFloat = 16

        let rows: (CGFloat) -> Int = { panel in
            StatusFlow.wrap(widths: widths, available: panel - padding, columnGap: gap).count
        }

        Checks.expect(rows(500), 1)
        Checks.expect(rows(400), 1)
        Checks.expect(rows(320), 2)
        Checks.expect(rows(220), 3)
        Checks.expect(rows(170), 4)

        // Which items share a line, not just how many lines — the 320 case is
        // "head · ctx · sess ⏎ week · comp" in the frame.
        let at320 = StatusFlow.wrap(widths: widths, available: 320 - padding, columnGap: gap)
        Checks.expect(at320[0], [0, 1, 2])
        Checks.expect(at320[1], [3, 4])

        let at220 = StatusFlow.wrap(widths: widths, available: 220 - padding, columnGap: gap)
        Checks.expect(at220[0], [0, 1])
        Checks.expect(at220[1], [2, 3])
        Checks.expect(at220[2], [4])

        // The one-line block measures 382pt, so it stops fitting just under 398 including padding.
        Checks.expect(StatusFlow.lineWidth(widths: widths, columnGap: gap), 382)
        Checks.expect(StatusFlow.fitsOnOneLine(widths: widths, available: 398 - padding, columnGap: gap), true)
        Checks.expect(StatusFlow.fitsOnOneLine(widths: widths, available: 397 - padding, columnGap: gap), false)
    }

    static func wrapEdges() {
        Checks.expect(StatusFlow.wrap(widths: [], available: 500, columnGap: 8).count, 0)

        // An item wider than the whole line still gets drawn, on a line of its own — dropping it
        // is how a narrow panel would silently lose the week ring.
        let tooWide = StatusFlow.wrap(widths: [400, 50], available: 100, columnGap: 8)
        Checks.expect(tooWide.count, 2)
        Checks.expect(tooWide[0], [0])

        // The column gap counts between items, never before the first one.
        Checks.expect(StatusFlow.wrap(widths: [50, 50], available: 108, columnGap: 8).count, 1)
        Checks.expect(StatusFlow.wrap(widths: [50, 50], available: 107, columnGap: 8).count, 2)
    }

    /// A weekly reset with no weekday is recognised — and still shown.
    ///
    /// Dropping it was the first attempt and left the line blank until the next payload carrying
    /// `seven_day` arrived. An hour without its day is poor; blank is worse.
    static func weekResetLegacy() {
        for bare in ["01:00", "1:00", "23:59"] {
            Checks.expect(isLegacyWeekReset(bare), true)
        }
        for real in ["Sun 1:00 AM", "Mon 11:30 PM"] {
            Checks.expect(isLegacyWeekReset(real), false)
        }
        Checks.expect(isLegacyWeekReset(nil), false)
        Checks.expect(isLegacyWeekReset(""), false)

        // And it survives the merge rather than being swallowed.
        var limits = RememberedLimits()
        limits.weekPercent = 12
        limits.weekResetsAt = "01:00"
        var thin = StatusLineSnapshot()
        thin.model = "Opus 5"
        Checks.expect(applyingLimits(limits, to: thin).weekResetsAt, "01:00")
    }

    /// Past the threshold the context ring says what to do about it.
    static func thresholdNotice() {
        var snap = StatusLineSnapshot()
        snap.totalTokens = 1_000_000

        // Under it: the budget, so the setting is visible.
        snap.usedPercent = 30
        Checks.expect(statusRings(snap, threshold: 60)[0].sub, "600k")

        // At it and past it: the way out, and it stays there rather than passing like a toast.
        snap.usedPercent = 60
        Checks.expect(statusRings(snap, threshold: 60)[0].sub, "/clear")
        Checks.expect(statusRings(snap, threshold: 60)[0].value, "100%")
        snap.usedPercent = 75
        Checks.expect(statusRings(snap, threshold: 60)[0].sub, "/clear")
        Checks.expect(statusRings(snap, threshold: 60)[0].level, StatusLevel.danger)

        // No threshold: the notice only fires against a budget someone set.
        snap.usedPercent = 75
        Checks.expect(statusRings(snap, threshold: 100)[0].sub, "1M")
    }

    /// The weekly reset carries its weekday.
    static func weekReset() {
        // A known instant: 2026-08-30 01:00 UTC is a Sunday. Compared in UTC so the case does
        // not change with wherever this runs.
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        var parts = DateComponents()
        parts.year = 2026; parts.month = 8; parts.day = 30; parts.hour = 1; parts.minute = 0
        let epoch = utc.date(from: parts)!.timeIntervalSince1970

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")!
        formatter.dateFormat = "EEE h:mm a"
        let expected = formatter.string(from: Date(timeIntervalSince1970: epoch))
        Checks.expect(expected, "Sun 1:00 AM")

        // What the row actually shows carries a weekday and an am/pm, whatever the zone. The old
        // formatter gave "01:00" — a time with no day, on a limit that resets once a week.
        let shown = formatWeekReset(epoch)
        Checks.expect(shown.split(separator: " ").count, 3)
        Checks.expect(shown.hasSuffix("AM") || shown.hasSuffix("PM"), true)
        Checks.expect(formatClock(epoch).contains(":"), true)
        Checks.expect(formatClock(epoch).count, 5)
    }

    /// The context ring's second line: the window it fills against.
    static func contextWindow() {
        var snap = StatusLineSnapshot()
        snap.totalTokens = 1_000_000
        // A threshold slices the window, and that slice is the only place the setting is visible.
        Checks.expect(contextWindowLabel(snap, threshold: 60), "600k")
        Checks.expect(contextWindowLabel(snap, threshold: 40), "400k")
        // No threshold — the whole window.
        Checks.expect(contextWindowLabel(snap, threshold: 100), "1M")
        Checks.expect(contextWindowLabel(snap, threshold: 0), "1M")
        // No window size: no line, rather than a made-up total.
        var blank = StatusLineSnapshot()
        blank.totalTokens = 0
        Checks.expect(contextWindowLabel(blank, threshold: 60), "")

        // The menu says the same thing the line says, so setting it and reading it agree.
        let choices = contextThresholdChoices(totalTokens: 1_000_000)
        Checks.expect(choices.first!.label, "1M · full window")
        Checks.expect(choices.first(where: { $0.percent == 60 })!.label, "600k · 60%")
        Checks.expect(choices.count, 8)
    }

    /// Snapshot to rings. The cases that matter are the incomplete ones.
    static func ringModel() {
        var full = StatusLineSnapshot()
        full.model = "Opus 5"
        full.usedTokens = 254321
        full.totalTokens = 1_000_000
        full.usedPercent = 25.4
        full.sessionPercent = 41
        full.sessionResetsInMin = 130
        full.weekPercent = 12
        full.weekResetsAt = "Sun 1:00 AM"
        full.compacted = 2
        full.compactBudget = 3

        full.compactAuto = 0

        let rings = statusRings(full, threshold: 60)
        Checks.expect(rings.map(\.name), ["Ctx", "Sess", "Week", "Comp"])

        // Number and arc answer the same question. At 25.4% of the window against a 60%
        // threshold, 42% of the budget is spent — and 42 is what both the ring and the figure
        // say. Showing 25 there would make the threshold decorative.
        Checks.expect(rings[0].value, "42%")
        if case .fraction(let f) = rings[0].fill {
            Checks.expect((f * 100).rounded(), 42)
        } else {
            Checks.expect("ctx fill", "fraction")
        }

        Checks.expect(rings[3].value, "2")
        // The second line counts the automatic compactions, not the budget — the budget is
        // already the number of segments in the ring.
        Checks.expect(rings[3].sub, "0 auto")
        Checks.expect(rings[3].level, StatusLevel.warn)

        // A fresh tab: Claude Code leaves rate limits out until the session has made a request.
        // Those rings are omitted, never drawn empty — an empty ring says "nothing used", which
        // is the opposite of "not known yet".
        var bare = StatusLineSnapshot()
        bare.usedPercent = 10
        bare.usedTokens = 100
        bare.totalTokens = 1000
        Checks.expect(statusRings(bare).map(\.name), ["Ctx"])

        // Over the threshold: the arc is capped by the geometry, the number is not. 92% of the
        // window against a 60% budget is 153% of it, and saying so is the point.
        var over = StatusLineSnapshot()
        over.usedPercent = 92
        over.totalTokens = 1000
        let hot = statusRings(over, threshold: 60)
        Checks.expect(hot[0].value, "153%")
        // Without a threshold the figure is the plain window percentage again.
        Checks.expect(statusRings(over, threshold: 100)[0].value, "92%")
        Checks.expect(hot[0].level, StatusLevel.danger)
        Checks.expect(RingGeometry.fillArc(fraction: 92 / 60).end, 420)

        // A threshold of zero must not divide by zero and quietly produce a NaN arc.
        var zero = StatusLineSnapshot()
        zero.usedPercent = 50
        if case .fraction(let f) = statusRings(zero, threshold: 0)[0].fill {
            Checks.expect(f, 0.5)
        } else {
            Checks.expect("zero threshold", "fraction")
        }
    }
}
