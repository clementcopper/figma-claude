import Foundation
import FigmaClaudeCore

/// The status line had no unit test in the Electron host — the producer was a script and the row
/// was DOM. Both are pure functions here, so these are the cases that were only ever checked by
/// looking at the window.
enum StatusLineTests {
    static func run() {
        percentages()
        formatting()
        levels()
        secondRow()
        emptiness()
        roundTrip()
    }

    static func percentages() {
        // Computed, never taken from the rounded field: on a 1M window `used_percentage` moves
        // in 10,000-token steps and disagrees with the count printed beside it.
        let snapshot = buildSnapshot([
            "context_window": ["context_window_size": 200_000,
                               "total_input_tokens": 83_400,
                               "used_percentage": 38]
        ])
        Checks.expect(snapshot.usedPercent, 41.7)

        // Without a window size there is nothing to compute from, so the field is all there is.
        let fallback = buildSnapshot(["context_window": ["used_percentage": 38]])
        Checks.expect(fallback.usedPercent, 38)
    }

    static func formatting() {
        // Integers from 100k up, one decimal below — so the number does not jitter between
        // "99.8k" and "100k" on every render.
        Checks.expect(formatTokens(999), "999")
        // Comma as the decimal separator, like the panel — and a whole number keeps no ",0",
        // which is noise in a row read at a glance.
        Checks.expect(formatTokens(1_500), "1,5k")
        Checks.expect(formatTokens(76_000), "76k")
        Checks.expect(formatTokens(99_800), "99,8k")
        Checks.expect(formatTokens(100_000), "100k")
        // A 1M window written as "1000k" is four characters of noise.
        Checks.expect(formatTokens(1_000_000), "1M")
        Checks.expect(formatTokens(1_500_000), "1,5M")
        Checks.expect(formatTokens(64_700), "64,7k")
        Checks.expect(formatTokens(200_000), "200k")

        Checks.expect(formatRemaining(0), "<1m")
        Checks.expect(formatRemaining(48), "48m")
        Checks.expect(formatRemaining(60), "1h")
        Checks.expect(formatRemaining(130), "2h 10m")

        // Keeps the tail, which is the part that identifies the project.
        Checks.expect(shortenPath("~/Documents/DMA/Designdone/Business"), "…/Designdone/Business")
        Checks.expect(shortenPath("~/Business"), "~/Business")
        Checks.expect(shortenPath("/a/b/c", maxSegments: 2), "/a/b/c")

        Checks.expect(collapseHome("/Users/x/Business", home: "/Users/x"), "~/Business")
        Checks.expect(collapseHome("/Users/x", home: "/Users/x"), "~")
        // A different user's path that merely starts with the same letters must not be collapsed.
        Checks.expect(collapseHome("/Users/xavier/Business", home: "/Users/x"), "/Users/xavier/Business")

        Checks.expect(buildEffort(["effort": ["level": "high"]]), "high")
        Checks.expect(buildEffort(["effort": ["level": "high"], "fast_mode": true]), "high · fast")
        Checks.expectNil(buildEffort([:]))
    }

    static func levels() {
        Checks.expect(contextLevel(69.9), .normal)
        Checks.expect(contextLevel(70), .warn)
        Checks.expect(contextLevel(89.9), .warn)
        Checks.expect(contextLevel(90), .danger)
        Checks.expect(limitLevel(79.9), .normal)
        Checks.expect(limitLevel(80), .danger)
    }

    static func secondRow() {
        let now = Date(timeIntervalSince1970: 1_000_000_000)

        var ahead = StatusLineSnapshot()
        ahead.sessionPercent = 41
        ahead.sessionResetsAt = now.timeIntervalSince1970 + 7800
        ahead.sessionResetsInMin = 130
        ahead.weekPercent = 12
        let rows = secondaryRowText(ahead, now: now)
        Checks.expect(rows?.left.hasPrefix("Session 41% · 2h 10m") ?? false, true)
        Checks.expect(rows?.week.hasPrefix("Week 12%") ?? false, true)

        // Past the reset point the row says so rather than losing its left half at the very
        // moment the waiting is over.
        var expired = StatusLineSnapshot()
        expired.sessionResetsAt = now.timeIntervalSince1970 - 60
        Checks.expect(secondaryRowText(expired, now: now)?.left, "Limit reset")

        // Compactions, with and without a budget.
        var compact = StatusLineSnapshot()
        compact.compacted = 3
        Checks.expect(secondaryRowText(compact, now: now)?.compacted, "Compacted 3")
        compact.compactBudget = 5
        compact.compactAuto = 2
        Checks.expect(secondaryRowText(compact, now: now)?.compacted, "Compacted 3/5 (2 auto)")

        // Nothing to say is nil, not an empty row taking up height.
        Checks.expectNil(secondaryRowText(StatusLineSnapshot(), now: now))
    }

    static func emptiness() {
        // A tab Claude has not rendered in yet must show nothing rather than a full bar at 0/0.
        Checks.expect(StatusLineSnapshot().isEmpty, true)
        var withModel = StatusLineSnapshot()
        withModel.model = "Opus 5"
        Checks.expect(withModel.isEmpty, false)
    }

    static func roundTrip() {
        // The window only ever sees the file, so what survives encoding is what it can draw.
        let dir = NSTemporaryDirectory() + "figmaclaude-checks-\(UUID().uuidString)"
        defer { try? FileManager.default.removeItem(atPath: dir) }

        var snapshot = StatusLineSnapshot()
        snapshot.model = "Opus 5"
        snapshot.usedPercent = 41.7
        snapshot.cwd = "~/Business"
        try? writeSnapshot(snapshot, dir: dir, tabId: "tab-1")

        let read = readSnapshot(dir: dir, tabId: "tab-1")
        Checks.expect(read?.model, "Opus 5")
        Checks.expect(read?.usedPercent, 41.7)
        Checks.expect(read?.cwd, "~/Business")
        Checks.expectNil(readSnapshot(dir: dir, tabId: "tab-2"))

        // No target named is the normal case outside a panel tab, not an error.
        Checks.expect(runStatusLineProducer(environment: [:]), false)
    }
}
