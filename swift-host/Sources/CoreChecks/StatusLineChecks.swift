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
        remembered()
        watcherRemembers()
        compactions()
        modelScoped()
        modelWeekChoice()
        rememberedModelWeeks()
        liveMerge()
        cwdLine()
        watcherLive()
        liveBuckets()
        sessionIdentity()
    }

    /// The whole path through the file system, because that is where the fault was: a tab whose
    /// second snapshot has no rate limits must keep the ones the first one brought.
    static func watcherRemembers() {
        let dir = NSTemporaryDirectory() + "figmaclaude-watcher-\(UUID().uuidString)"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let watcher = StatusLineWatcher(dir: dir, interval: 0.05) { _, _ in }
        watcher.start()
        defer { watcher.stop() }

        // What a session that has made a request reports.
        var full = StatusLineSnapshot()
        full.model = "Opus 5"
        full.cwd = "~/Business"
        full.totalTokens = 1_000_000
        full.usedTokens = 63_723
        full.usedPercent = 6.4
        full.sessionPercent = 68
        full.sessionResetsAt = Date().timeIntervalSince1970 + 3600
        full.weekPercent = 87
        full.weekResetsAt = "01:00"
        full.updatedAt = Date().timeIntervalSince1970
        try? writeSnapshot(full, dir: dir, tabId: "tab-1")
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        Checks.expect(watcher.snapshot(for: "tab-1")?.sessionPercent, 68)

        // What Claude Code writes right after `--continue`: no rate limits at all, no window size.
        var thin = StatusLineSnapshot()
        thin.model = "Opus 5"
        thin.cwd = "~/Business"
        thin.updatedAt = Date().timeIntervalSince1970 + 1
        try? writeSnapshot(thin, dir: dir, tabId: "tab-1")
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))

        let merged = watcher.snapshot(for: "tab-1")
        Checks.expect(merged?.sessionPercent, 68)
        Checks.expect(merged?.weekPercent, 87)
        // The scale comes back too, so the bar keeps a length — the usage stays what was reported.
        Checks.expect(merged?.totalTokens, 1_000_000)
        Checks.expect(merged?.usedTokens, 0)

        // Remembering never goes backwards. The first scan reads the whole directory in whatever
        // order the file system hands it over, and an older file must not win.
        var older = full
        older.sessionPercent = 12
        older.updatedAt = full.updatedAt - 3600
        try? writeSnapshot(older, dir: dir, tabId: "tab-2")
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        try? writeSnapshot(thin, dir: dir, tabId: "tab-3")
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        Checks.expect(watcher.snapshot(for: "tab-3")?.sessionPercent, 68)

        // A tab that has never rendered starts from the directory's remembered state.
        let seeded = watcher.initialSnapshot(cwd: "~/Business")
        Checks.expect(seeded?.totalTokens, 1_000_000)
        Checks.expect(seeded?.sessionPercent, 68)
        // An unknown directory still names itself rather than answering nothing.
        Checks.expect(watcher.initialSnapshot(cwd: "/tmp/never-seen")?.cwd, "/tmp/never-seen")
        Checks.expectNil(watcher.initialSnapshot(cwd: ""))
    }

    /// What keeps the Session and Week row standing when Claude Code sends a payload without any
    /// rate limits — which is every render after `--continue` until the first request.
    static func remembered() {
        let now = Date().timeIntervalSince1970 * 1000
        var limits = RememberedLimits()
        limits.sessionPercent = 68
        limits.sessionResetsAt = now / 1000 + 3600
        limits.sessionResetsInMin = 60
        limits.weekPercent = 87
        limits.weekResetsAt = "01:00"   // the legacy shape, deliberately

        // A thin snapshot gets them all.
        var thin = StatusLineSnapshot()
        thin.model = "Opus 5"
        let filled = applyingLimits(limits, to: thin, now: now)
        Checks.expect(filled.sessionPercent, 68)
        Checks.expect(filled.weekPercent, 87)
        Checks.expect(filled.weekResetsAt, "01:00")
        // Recomputed from the absolute point, not copied: the remembered minutes may be old.
        Checks.expect(filled.sessionResetsInMin, 60)

        // A live value always wins over a remembered one.
        var live = StatusLineSnapshot()
        live.sessionPercent = 12
        live.weekPercent = 3
        let kept = applyingLimits(limits, to: live, now: now)
        Checks.expect(kept.sessionPercent, 12)
        Checks.expect(kept.weekPercent, 3)

        // A window that has already reset takes the percentage with it rather than showing a
        // spent limit that is over.
        var expired = RememberedLimits()
        expired.sessionPercent = 100
        expired.sessionResetsAt = now / 1000 - 60
        let gone = applyingLimits(expired, to: StatusLineSnapshot(), now: now)
        Checks.expectNil(gone.sessionPercent)
        Checks.expectNil(gone.sessionResetsInMin)
        // And the point itself is not carried over either: a row that says "Limit reset" is about
        // a live limit running out, not about a window that closed hours ago.
        Checks.expectNil(gone.sessionResetsAt)
        Checks.expectNil(secondaryRowText(gone).map { $0.left }.flatMap { $0.isEmpty ? nil : $0 })

        // Nothing remembered leaves the snapshot exactly as it was.
        Checks.expect(applyingLimits(nil, to: live, now: now), live)
        // A snapshot with no limits of its own is not worth remembering.
        Checks.expectNil(limitFields(of: thin))
        Checks.expect(limitFields(of: filled)?.weekPercent, 87)

        // The scale may come from memory, the usage never: a fresh session really is at zero.
        var remembered = StatusLineSnapshot()
        remembered.totalTokens = 1_000_000
        remembered.usedTokens = 63_723
        var fresh = StatusLineSnapshot()
        fresh.usedTokens = 47_524
        let scaled = applyingWindowSize(fresh, remembered: remembered)
        Checks.expect(scaled.totalTokens, 1_000_000)
        Checks.expect(scaled.usedTokens, 47_524)
        Checks.expect(scaled.usedPercent, 4.8)
        // A payload that brought its own window size is left alone.
        var own = StatusLineSnapshot()
        own.totalTokens = 200_000
        own.usedTokens = 10_000
        own.usedPercent = 5
        Checks.expect(applyingWindowSize(own, remembered: remembered).totalTokens, 200_000)
        Checks.expect(applyingWindowSize(fresh, remembered: nil).totalTokens, 0)

        // One key for the same directory written two ways, and never a path separator in it.
        let home = "/Users/x"
        Checks.expect(cwdKey("/Users/x/p", home: home), cwdKey("~/p", home: home))
        Checks.expect(cwdKey("/Users/x/p", home: home).contains("/"), false)
        Checks.expect(cwdKey("/Users/x/p", home: home).count, 16)
        Checks.expect(cwdKey("/Users/x/p", home: home) == cwdKey("/Users/x/q", home: home), false)
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
        Checks.expect(shortenPath("~/Documents/DMA/Designdone/Business"), "~/Designdone/Business")
        Checks.expect(shortenPath("~/Business"), "~/Business")
        Checks.expect(shortenPath("/a/b/c", maxSegments: 2), "/a/b/c")
        // Outside the home directory there is no tilde to lead with, so the ellipsis stays.
        Checks.expect(shortenPath("/Volumes/Extern/Kunden/Designdone/Business"),
                      "…/Designdone/Business")

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
        // Marker is 10 points of orange before the red line.
        Checks.expect(contextFillLevel(49.9, marker: 60), .normal)
        Checks.expect(contextFillLevel(50, marker: 60), .warn)
        Checks.expect(contextFillLevel(59.9, marker: 60), .warn)
        Checks.expect(contextFillLevel(60, marker: 60), .danger)
        Checks.expect(contextFillLevel(94, marker: 60), .danger)
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

    static func compactions() {
        // testCountsCompactionsFromTheTranscriptBytes
        let file = NSTemporaryDirectory() + "figmaclaude-transcript-\(UUID().uuidString).jsonl"
        defer { try? FileManager.default.removeItem(atPath: file) }
        // One line without the marker, one manual compaction, one automatic — and a line where
        // the auto markers sit on a *different* record than the summary, which must not count.
        let transcript = [
            "{\"type\":\"user\",\"message\":\"isCompact? no — that word alone is not the marker\"}",
            "{\"type\":\"user\",\"isCompactSummary\":true,\"message\":\"manual\"}",
            "{\"type\":\"user\",\"isCompactSummary\":true,\"compactMetadata\":{\"trigger\":\"auto\"}}",
            "{\"type\":\"system\",\"compactMetadata\":{\"trigger\":\"auto\"}}",
            "{\"isCompactSummary\":true,\"compactMetadata\":{\"trigger\":\"manual\"}}"
        ].joined(separator: "\n")
        try? transcript.write(toFile: file, atomically: true, encoding: .utf8)
        let counted = countCompactions(file)
        Checks.expect(counted.total, 3)
        Checks.expect(counted.auto, 1)

        // Last line without a trailing newline, and a file that is not there.
        try? (transcript + "\n{\"isCompactSummary\":true}").write(toFile: file, atomically: true, encoding: .utf8)
        Checks.expect(countCompactions(file).total, 4)
        Checks.expect(countCompactions(file + ".missing").total, 0)
    }

    /// `rate_limits.model_scoped` is the per-model weekly bucket (`/usage` shows it as "Current
    /// week (Fable)"). Its `resets_at` is an ISO string, unlike the epoch next to it.
    static func modelScoped() {
        let payload: [String: Any] = [
            "model": ["display_name": "Fable 5.1"],
            "rate_limits": [
                "seven_day": ["used_percentage": 41, "resets_at": 1_791_568_800],
                "model_scoped": [
                    ["display_name": "Fable", "utilization": 38, "resets_at": "2026-10-09T18:00:00.000Z"],
                    // A bucket without a reading is not a bucket at 0%.
                    ["display_name": "Opus", "utilization": NSNull(), "resets_at": NSNull()],
                    ["display_name": "Sonnet", "utilization": 7.5, "resets_at": NSNull()]
                ]
            ]
        ]
        let snap = buildSnapshot(payload)
        Checks.expect(snap.weekPercent, 41)
        Checks.expect(snap.modelWeeks, [
            ModelWeek(label: "Fable", percent: 38, resetsAt: 1_791_568_800),
            ModelWeek(label: "Sonnet", percent: 7.5, resetsAt: nil)
        ])

        // Absent: nothing known, not an empty list — a remembered one may fill it.
        Checks.expectNil(buildSnapshot(["rate_limits": ["seven_day": ["used_percentage": 1]]]).modelWeeks)
        // Present but empty: the endpoint answered and listed none. Kept as empty.
        Checks.expect(buildSnapshot(["rate_limits": ["model_scoped": [] as [Any]]]).modelWeeks, [])

        // Round trip through the file, as the watcher reads it.
        let data = try! JSONEncoder().encode(snap)
        Checks.expect(try? JSONDecoder().decode(StatusLineSnapshot.self, from: data).modelWeeks,
                      snap.modelWeeks)
        // A snapshot written before the field existed still decodes.
        let old = Data(#"{"model":"Opus 5","usedTokens":1,"totalTokens":2,"usedPercent":50,"updatedAt":1}"#.utf8)
        Checks.expectNil(try? JSONDecoder().decode(StatusLineSnapshot.self, from: old).modelWeeks)
    }

    /// The bucket the session's model falls into: label is a prefix of the display name, case
    /// aside. No match, no bucket — the Week ring then shows the all-models limit as before.
    static func modelWeekChoice() {
        var snap = StatusLineSnapshot()
        snap.modelWeeks = [ModelWeek(label: "Fable", percent: 38, resetsAt: nil),
                           ModelWeek(label: "Sonnet", percent: 7, resetsAt: nil)]
        snap.model = "Fable 5.1"
        Checks.expect(modelWeek(for: snap)?.label, "Fable")
        snap.model = "sonnet 5.5"
        Checks.expect(modelWeek(for: snap)?.label, "Sonnet")
        snap.model = "Opus 5"
        Checks.expectNil(modelWeek(for: snap))
        snap.model = ""
        Checks.expectNil(modelWeek(for: snap))
        snap.model = "Fable 5.1"
        snap.modelWeeks = nil
        Checks.expectNil(modelWeek(for: snap))
    }

    /// The per-model buckets are account state like the other limits: remembered, filled into a
    /// thin snapshot, never overwriting a live reading — and an old `limits.json` without them
    /// still decodes.
    static func rememberedModelWeeks() {
        var full = StatusLineSnapshot()
        full.modelWeeks = [ModelWeek(label: "Fable", percent: 38, resetsAt: 1_791_568_800)]
        full.updatedAt = 5
        let kept = limitFields(of: full)
        Checks.expect(kept?.modelWeeks, full.modelWeeks)

        var thin = StatusLineSnapshot()
        thin.model = "Fable 5.1"
        Checks.expect(applyingLimits(kept, to: thin).modelWeeks, full.modelWeeks)

        var live = StatusLineSnapshot()
        live.modelWeeks = []
        Checks.expect(applyingLimits(kept, to: live).modelWeeks, [])

        let old = Data(#"{"weekPercent":40,"weekResetsAt":"Fri 8:00 PM","updatedAt":1}"#.utf8)
        let decoded = try? JSONDecoder().decode(RememberedLimits.self, from: old)
        Checks.expect(decoded?.weekPercent, 40)
        Checks.expectNil(decoded?.modelWeeks)
    }

    /// What the panel-bridge mod writes beside the producer's file, merged into the snapshot:
    /// the mod sees every model request, so inside a turn its token count is the live one.
    static func liveMerge() {
        let json = #"{"v":1,"updatedAt":1791271305925,"resetAt":0,"cwd":"/Users/x/figma-cli","usedTokens":123157,"totalTokens":1000000,"usedPercent":12.3,"stepIndex":18,"modelId":"claude-fable-5-1","effort":"high","state":"busy","stateAt":1791270893391,"tool":{"name":"Bash","summary":"Read schema grep output"},"agents":2,"compacted":0,"compactAuto":0,"sessionPercent":50,"weekPercent":40,"costUsd":3.72}"#
        guard let live = try? JSONDecoder().decode(LiveStatus.self, from: Data(json.utf8)) else {
            Checks.expect("decoded", "LiveStatus"); return
        }
        Checks.expect(live.usedTokens, 123_157)
        Checks.expect(live.tool?.name, "Bash")
        Checks.expect(live.agents, 2)

        // The producer rendered a moment earlier; the mod's newer count wins and the percent
        // follows the same arithmetic as the producer's.
        var snap = StatusLineSnapshot()
        snap.cwd = "~/figma-cli"
        snap.usedTokens = 100_000
        snap.totalTokens = 1_000_000
        snap.usedPercent = 10
        snap.updatedAt = 1_791_271_300
        let merged = applyingLive(live, to: snap)
        Checks.expect(merged.usedTokens, 123_157)
        Checks.expect(merged.usedPercent, 12.3)
        Checks.expect(merged.totalTokens, 1_000_000)
        Checks.expect(merged.activity, StatusActivity(tool: "Bash", summary: "Read schema grep output", agents: 2))

        // A producer render after the mod's last write is the newer truth.
        snap.updatedAt = 1_791_271_306
        let later = applyingLive(live, to: snap)
        Checks.expect(later.usedTokens, 100_000)
        Checks.expect(later.usedPercent, 10)
        Checks.expectNil(later.activity)

        // No live file: nothing changes.
        Checks.expect(applyingLive(nil, to: snap), snap)

        // After `/clear` the mod drops its count; the producer's stands. The window comes from
        // the live file only when the producer has none yet.
        var cleared = live
        cleared.usedTokens = nil
        cleared.state = "idle"
        cleared.tool = nil
        cleared.agents = 0
        var fresh = StatusLineSnapshot()
        fresh.updatedAt = 1_791_271_300
        let seeded = applyingLive(cleared, to: fresh)
        Checks.expect(seeded.usedTokens, 0)
        Checks.expect(seeded.totalTokens, 1_000_000)
        Checks.expect(seeded.usedPercent, 0)
        Checks.expectNil(seeded.activity)

        // Idle with a tool still named is a stale entry, not activity.
        snap.updatedAt = 1_791_271_300
        var idle = live
        idle.state = "idle"
        Checks.expectNil(applyingLive(idle, to: snap).activity)
        // Agents alone are activity.
        var agentsOnly = live
        agentsOnly.tool = nil
        Checks.expect(applyingLive(agentsOnly, to: snap).activity, StatusActivity(tool: nil, summary: nil, agents: 2))
    }

    /// The working-directory line doubles as the activity line: the tool at work and the
    /// subagents running, and the path again the moment both are gone.
    static func cwdLine() {
        var snap = StatusLineSnapshot()
        snap.cwd = "~/work/clients/acme/services/api"
        Checks.expect(cwdLineText(snap).text, "~/services/api")
        Checks.expect(cwdLineText(snap).tooltip, "~/work/clients/acme/services/api")

        snap.activity = StatusActivity(tool: "Bash", summary: "Install deps", agents: 0)
        Checks.expect(cwdLineText(snap).text, "Bash: Install deps")
        Checks.expect(cwdLineText(snap).tooltip, "~/work/clients/acme/services/api\nBash: Install deps")

        snap.activity = StatusActivity(tool: "Read", summary: "/Users/x/a.swift", agents: 2)
        Checks.expect(cwdLineText(snap).text, "Read: /Users/x/a.swift · 2 agents")

        snap.activity = StatusActivity(tool: nil, summary: nil, agents: 1)
        Checks.expect(cwdLineText(snap).text, "1 agent")
        Checks.expect(cwdLineText(snap).tooltip, "~/work/clients/acme/services/api")

        // A long summary is cut for the line and whole in the tooltip.
        let long = String(repeating: "x", count: 80)
        snap.activity = StatusActivity(tool: "Bash", summary: long, agents: 0)
        Checks.expect(cwdLineText(snap).text, "Bash: " + String(repeating: "x", count: 59) + "…")
        Checks.expect(cwdLineText(snap).tooltip, "~/work/clients/acme/services/api\nBash: " + long)

        // A tool without a summary is still named.
        snap.activity = StatusActivity(tool: "Glob", summary: "", agents: 0)
        Checks.expect(cwdLineText(snap).text, "Glob")

        // No path at all: the activity alone, or nothing.
        snap.cwd = nil
        Checks.expect(cwdLineText(snap).text, "Glob")
        snap.activity = nil
        Checks.expect(cwdLineText(snap).text, "")
    }

    /// The watcher reads both files per tab and never mistakes `<id>.live.json` for a tab of its
    /// own; a live write alone re-renders, and forgetting a tab removes both.
    static func watcherLive() {
        let dir = NSTemporaryDirectory() + "figmaclaude-live-\(UUID().uuidString)"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: dir) }

        var seenTabs: [String] = []
        let watcher = StatusLineWatcher(dir: dir, interval: 0.05) { tabId, _ in seenTabs.append(tabId) }
        watcher.start()
        defer { watcher.stop() }

        var written = StatusLineSnapshot()
        written.model = "Fable 5.1"
        written.cwd = "~/p"
        written.usedTokens = 100_000
        written.totalTokens = 1_000_000
        written.usedPercent = 10
        written.updatedAt = Date().timeIntervalSince1970.rounded(.down)
        try? writeSnapshot(written, dir: dir, tabId: "tab-9")
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        Checks.expect(watcher.snapshot(for: "tab-9")?.usedTokens, 100_000)

        let liveMs = (written.updatedAt + 2) * 1000
        let live = "{\"v\":1,\"updatedAt\":\(Int(liveMs)),\"usedTokens\":150000,\"totalTokens\":1000000,\"state\":\"busy\",\"tool\":{\"name\":\"Bash\",\"summary\":\"ls\"},\"agents\":0}"
        try? Data(live.utf8).write(to: URL(fileURLWithPath: "\(dir)/tab-9.live.json"))
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        Checks.expect(watcher.snapshot(for: "tab-9")?.usedTokens, 150_000)
        Checks.expect(watcher.snapshot(for: "tab-9")?.activity?.tool, "Bash")
        Checks.expectNil(watcher.snapshot(for: "tab-9.live"))
        Checks.expect(Set(seenTabs), ["tab-9"])
        Checks.expect(seenTabs.count, 2)

        watcher.forget("tab-9")
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        Checks.expect(FileManager.default.fileExists(atPath: "\(dir)/tab-9.json"), false)
        Checks.expect(FileManager.default.fileExists(atPath: "\(dir)/tab-9.live.json"), false)
    }

    /// The mod asks the usage endpoint for the per-model buckets, so the live file carries them
    /// too: newer than the producer's snapshot they win, including over a remembered set, and
    /// the merged snapshot is what gets remembered — without the activity, which is now.
    static func liveBuckets() {
        let fable = ModelWeek(label: "Fable", percent: 79, resetsAt: 1_791_568_800)
        let json = #"{"v":1,"updatedAt":1791271305925,"usedTokens":5,"totalTokens":100,"state":"busy","tool":{"name":"Bash","summary":"ls"},"agents":0,"modelWeeks":[{"label":"Fable","percent":79,"resetsAt":1791568800}]}"#
        guard let live = try? JSONDecoder().decode(LiveStatus.self, from: Data(json.utf8)) else {
            Checks.expect("decoded", "LiveStatus"); return
        }
        Checks.expect(live.modelWeeks, [fable])

        var snap = StatusLineSnapshot()
        snap.model = "Fable 5.1"
        snap.updatedAt = 1_791_271_300
        snap.modelWeeks = [ModelWeek(label: "Fable", percent: 70, resetsAt: nil)]   // older, remembered
        let merged = applyingLive(live, to: snap)
        Checks.expect(merged.modelWeeks, [fable])
        // The snapshot now stands for the live file's moment, so remembering it is never a step back.
        Checks.expect(merged.updatedAt, 1_791_271_305)
        Checks.expect(limitFields(of: merged)?.modelWeeks, [fable])

        // Older live file: the snapshot's buckets stay.
        snap.updatedAt = 1_791_271_310
        Checks.expect(applyingLive(live, to: snap).modelWeeks?.first?.percent, 70)
        Checks.expect(applyingLive(live, to: snap).updatedAt, 1_791_271_310)

        // A live file without buckets leaves the snapshot's alone.
        var bare = live
        bare.modelWeeks = nil
        snap.updatedAt = 1_791_271_300
        Checks.expect(applyingLive(bare, to: snap).modelWeeks?.first?.percent, 70)

        // Activity never reaches a file: a remembered snapshot must not revive a tool.
        var busy = StatusLineSnapshot()
        busy.activity = StatusActivity(tool: "Bash", summary: "ls", agents: 1)
        let data = try! JSONEncoder().encode(busy)
        Checks.expect(String(decoding: data, as: UTF8.self).contains("activity"), false)
        Checks.expectNil(try? JSONDecoder().decode(StatusLineSnapshot.self, from: data).activity)
    }

    /// The payload names the session: the one thing the host cannot know after `--continue`
    /// or `--resume`, and what a restart needs to bring the tab back.
    static func sessionIdentity() {
        let snap = buildSnapshot(["session_id": "ae15e934-dffb-4b7d-b36e-8d9f9956850c",
                                  "session_name": "fc-design-7f3a"])
        Checks.expect(snap.sessionId, "ae15e934-dffb-4b7d-b36e-8d9f9956850c")
        Checks.expect(snap.sessionName, "fc-design-7f3a")
        Checks.expectNil(buildSnapshot([:]).sessionId)
        Checks.expectNil(buildSnapshot(["session_name": ""]).sessionName)
        let data = try! JSONEncoder().encode(snap)
        Checks.expect(try? JSONDecoder().decode(StatusLineSnapshot.self, from: data).sessionId, snap.sessionId)
    }
}
