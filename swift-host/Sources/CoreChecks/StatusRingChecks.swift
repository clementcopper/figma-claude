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

        let rings = statusRings(full, threshold: 60)
        Checks.expect(rings.map(\.name), ["Ctx", "Sess", "Week", "Comp"])

        // The number is the raw percentage; the fill is measured against the threshold. At 25.4%
        // of a 60% budget the ring is only just over 40% full — reading the arc as 25% would make
        // the threshold decorative.
        Checks.expect(rings[0].value, "25%")
        if case .fraction(let f) = rings[0].fill {
            Checks.expect((f * 100).rounded(), 42)
        } else {
            Checks.expect("ctx fill", "fraction")
        }

        Checks.expect(rings[3].value, "2")
        Checks.expect(rings[3].sub, "of 3")
        Checks.expect(rings[3].level, StatusLevel.warn)

        // A fresh tab: Claude Code leaves rate limits out until the session has made a request.
        // Those rings are omitted, never drawn empty — an empty ring says "nothing used", which
        // is the opposite of "not known yet".
        var bare = StatusLineSnapshot()
        bare.usedPercent = 10
        bare.usedTokens = 100
        bare.totalTokens = 1000
        Checks.expect(statusRings(bare).map(\.name), ["Ctx"])

        // Over the threshold: the arc is capped by the geometry, the number is not.
        var over = StatusLineSnapshot()
        over.usedPercent = 92
        over.totalTokens = 1000
        let hot = statusRings(over, threshold: 60)
        Checks.expect(hot[0].value, "92%")
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
