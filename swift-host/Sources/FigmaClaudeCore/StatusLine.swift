import CryptoKit
import Foundation

/// Claude Code's own status line: model, context, and the two rate limits.
///
/// Claude Code hands the session data to the configured `statusLine` command on stdin and to
/// nobody else — from the PTY the host only gets bytes. Port of
/// `app/resources/panel-statusline.cjs`, with one thing dropped: there the producer had to be a
/// separate Node script because Electron's renderer could not run it. Here the app *is* the
/// producer, invoked as `FigmaClaude --statusline`.

public let statusDirKey = "CLAUDE_PANEL_STATUS_DIR"
public let statusTabKey = "CLAUDE_PANEL_TAB_ID"
public let statusBudgetKey = "CLAUDE_PANEL_COMPACT_BUDGET"
public let statusDelegateKey = "CLAUDE_PANEL_DELEGATE"

/// Where the snapshots live. Beside the daemon token, so one directory holds the panel's state.
public func statusLineDir() -> String {
    NSHomeDirectory() + "/.figma-ds-cli/statusline"
}

public struct StatusLineSnapshot: Codable, Equatable {
    public var model: String = ""
    public var effort: String?
    public var cwd: String?
    public var usedTokens: Int = 0
    public var totalTokens: Int = 0
    public var usedPercent: Double = 0
    public var sessionPercent: Double?
    public var sessionResetsAt: Double?
    public var sessionResetsInMin: Int?
    public var weekPercent: Double?
    public var weekResetsAt: String?
    public var compacted: Int?
    public var compactBudget: Int?
    public var compactAuto: Int?
    public var updatedAt: Double = 0

    public init() {}

    /// Nothing to draw yet: a tab Claude has not rendered in carries no numbers, and a full bar
    /// reading `0 / 0` is worse than an empty row.
    public var isEmpty: Bool {
        model.isEmpty && effort == nil && totalTokens == 0
    }
}

// MARK: - Building one from what Claude Code sends

private func number(_ value: Any?) -> Double? {
    if let d = value as? Double, d.isFinite { return d }
    if let i = value as? Int { return Double(i) }
    return nil
}

/// `~` instead of the home directory, the way a shell prompt would show it.
public func collapseHome(_ dir: String, home: String = NSHomeDirectory()) -> String {
    guard !home.isEmpty else { return dir }
    if dir == home { return "~" }
    if dir.hasPrefix(home + "/") { return "~" + dir.dropFirst(home.count) }
    return dir
}

/// Effort level plus fast mode, e.g. `high · fast`.
public func buildEffort(_ payload: [String: Any]) -> String? {
    var parts: [String] = []
    if let effort = payload["effort"] as? [String: Any], let level = effort["level"] as? String,
       !level.isEmpty {
        parts.append(level)
    }
    if let fast = payload["fast_mode"] as? Bool, fast { parts.append("fast") }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
}

public func buildSnapshot(_ payload: [String: Any], budget: Int = 0,
                          now: Date = Date()) -> StatusLineSnapshot {
    var snapshot = StatusLineSnapshot()

    let contextWindow = payload["context_window"] as? [String: Any] ?? [:]
    snapshot.totalTokens = Int(number(contextWindow["context_window_size"]) ?? 0)
    snapshot.usedTokens = Int(number(contextWindow["total_input_tokens"]) ?? 0)

    // Computed rather than taken from `used_percentage`: that field is rounded to whole percent,
    // so on a 1M window it moves in 10,000-token steps and disagrees with the count beside it.
    let percent = snapshot.totalTokens > 0
        ? Double(snapshot.usedTokens) / Double(snapshot.totalTokens) * 100
        : (number(contextWindow["used_percentage"]) ?? 0)
    snapshot.usedPercent = (percent * 10).rounded() / 10

    let rateLimits = payload["rate_limits"] as? [String: Any] ?? [:]
    let fiveHour = rateLimits["five_hour"] as? [String: Any] ?? [:]
    let sevenDay = rateLimits["seven_day"] as? [String: Any] ?? [:]

    snapshot.sessionPercent = number(fiveHour["used_percentage"])
    // Both: the absolute point survives being remembered across sessions, the minutes stay for
    // any reader that does not know the newer field.
    snapshot.sessionResetsAt = number(fiveHour["resets_at"])
    snapshot.weekPercent = number(sevenDay["used_percentage"])
    snapshot.weekResetsAt = number(sevenDay["resets_at"]).map { formatWeekReset($0) }

    // The reset-window rule is already ported and is used rather than restated: it decides when
    // the percentage falls and why the absolute point stays.
    let limits = applyResetWindow(
        LimitFields(sessionPercent: snapshot.sessionPercent,
                    sessionResetsAt: snapshot.sessionResetsAt),
        now: now.timeIntervalSince1970 * 1000)
    snapshot.sessionPercent = limits.sessionPercent
    snapshot.sessionResetsInMin = limits.sessionResetsInMin

    if let model = payload["model"] as? [String: Any], let name = model["display_name"] as? String {
        snapshot.model = name
    }
    snapshot.effort = buildEffort(payload)

    let workspace = payload["workspace"] as? [String: Any] ?? [:]
    let rawCwd = (payload["cwd"] as? String) ?? (workspace["current_dir"] as? String) ?? ""
    snapshot.cwd = rawCwd.isEmpty ? nil : collapseHome(rawCwd)

    if let transcript = payload["transcript_path"] as? String {
        let counted = countCompactions(transcript)
        snapshot.compacted = counted.total
        snapshot.compactAuto = counted.auto
    }
    snapshot.compactBudget = budget > 0 ? budget : nil
    snapshot.updatedAt = now.timeIntervalSince1970.rounded(.down)

    return snapshot
}

/// How often this session has been compacted, and how many of those were automatic. Read from
/// the transcript because nothing in the payload says it.
public func countCompactions(_ transcriptPath: String) -> (total: Int, auto: Int) {
    guard let handle = FileHandle(forReadingAtPath: transcriptPath) else { return (0, 0) }
    defer { try? handle.close() }
    guard let data = try? handle.readToEnd() else { return (0, 0) }

    var total = 0
    var auto = 0
    for line in String(decoding: data, as: UTF8.self).split(separator: "\n") {
        guard line.contains("isCompactSummary") else { continue }
        total += 1
        if line.contains("\"compactMetadata\"") && line.contains("\"trigger\":\"auto\"") { auto += 1 }
    }
    return (total, auto)
}

// MARK: - Formatting, kept pure so the row can be asserted rather than looked at

/// Integers from 100k up, one decimal below — the same rule the panel uses, so the number does
/// not jitter between `99.8k` and `100k` on every render.
public func formatTokens(_ tokens: Int) -> String {
    // Millions get their own unit: a 1M window written as "1000k" is four characters of noise
    // in the one place on screen that is read at a glance.
    if tokens >= 1_000_000 { return decimalUnit(Double(tokens) / 1_000_000, "M") }
    // Integers from 100k up: below that a tenth still says something, above it the number would
    // only jitter between "99,8k" and "100k" on every render.
    if tokens >= 100_000 { return "\(Int((Double(tokens) / 1000).rounded()))k" }
    if tokens >= 1_000 { return decimalUnit(Double(tokens) / 1000, "k") }
    return String(tokens)
}

/// One decimal, comma as the separator like the panel uses — and a whole number keeps no ",0",
/// which is noise rather than precision.
private func decimalUnit(_ value: Double, _ unit: String) -> String {
    let rounded = (value * 10).rounded() / 10
    if rounded == rounded.rounded() { return "\(Int(rounded))\(unit)" }
    return String(format: "%.1f", rounded).replacingOccurrences(of: ".", with: ",") + unit
}

/// Keeps the tail of a path, which is the part that identifies the project.
/// `~/work/clients/acme/api` becomes `…/acme/api`; short paths stay whole.
public func shortenPath(_ path: String, maxSegments: Int = 2) -> String {
    let segments = path.split(separator: "/").filter { !$0.isEmpty }
    if segments.count <= maxSegments || path.count <= 28 { return path }
    // Under the home directory the tilde carries the head, rather than an ellipsis that says
    // "something was cut" without saying where from. `collapseHome` has already put it there;
    // this used to throw it away. Outside home there is nothing to stand in, so the ellipsis
    // remains — and either way the label's tooltip holds the full path.
    let head = segments.first == "~" ? "~/" : "…/"
    return head + segments.suffix(maxSegments).joined(separator: "/")
}

/// `2h 10m`, `48m`, `<1m` — the answer to "can I prompt again yet".
public func formatRemaining(_ minutes: Int) -> String {
    if minutes <= 0 { return "<1m" }
    if minutes < 60 { return "\(minutes)m" }
    let hours = minutes / 60
    let rest = minutes % 60
    return rest == 0 ? "\(hours)h" : "\(hours)h \(rest)m"
}

/// The wall-clock time a limit resets at — what you plan around once you know it is a while.
public func formatClock(_ epochSeconds: Double) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "HH:mm"
    return formatter.string(from: Date(timeIntervalSince1970: epochSeconds))
}

/// When the weekly bucket refills: weekday and hour, not just an hour.
///
/// `formatClock` gives "01:00", which is what the week ring showed — and a bare time on a limit
/// that resets once a week says nothing about *which* day, so it read as "in the next hour". The
/// epoch is in the payload the whole time; only the formatter was throwing the day away.
///
/// Fixed English weekday abbreviations rather than the user's locale: the row is 9pt and mixes
/// with English labels either way, and a locale that spells Sunday as five characters would move
/// the widest group in the bar.
public func formatWeekReset(_ epochSeconds: Double) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "EEE h:mm a"
    return formatter.string(from: Date(timeIntervalSince1970: epochSeconds))
}

/// Whether a weekly reset still carries the shape written before `formatWeekReset` existed.
///
/// Those values are bare clock times — "01:00" — and they outlive the fix: they sit in every
/// tab's file and in the remembered `limits.json`. Dropping them was the first attempt and made
/// the line blank until the next payload with `seven_day` data arrived, which can be a while: an
/// hour without its day is poor, but blank says nothing at all. So it is shown and replaced the
/// moment a real value lands.
public func isLegacyWeekReset(_ text: String?) -> Bool {
    guard let text, !text.isEmpty else { return false }
    return text.range(of: "^\\d{1,2}:\\d{2}$", options: .regularExpression) != nil
}

/// How alarming the number is. One name, so bar and figure can never disagree.
public enum StatusLevel: String { case normal, warn, danger }

public func contextLevel(_ usedPercent: Double) -> StatusLevel {
    if usedPercent >= 90 { return .danger }
    if usedPercent >= 70 { return .warn }
    return .normal
}

public func limitLevel(_ percent: Double) -> StatusLevel {
    percent >= 80 ? .danger : .normal
}

/// How urgent the context fill is against a user-set clear threshold.
///
/// This is the marker on the context bar, deliberately separate from `contextLevel` (which
/// colours against the provider's rate limits — the "waiting" problem). Here the whole fill stays
/// normal until the last 10 points before the marker, then warns, and turns danger the moment the
/// marker is crossed — the "should clear" problem. The marker is the user's own number, so it
/// comes in as a parameter and never lives here.
public func contextFillLevel(_ usedPercent: Double, marker: Double) -> StatusLevel {
    if usedPercent >= marker        { return .danger }
    if usedPercent >= marker - 10   { return .warn }
    return .normal
}

/// The second row, as text. Returns nil when there is nothing to say.
/// The second row, split so each piece can be coloured for what it is. Compactions are a count,
/// not a limit — colouring them red because the week is nearly spent says the wrong thing.
public func secondaryRowText(_ snapshot: StatusLineSnapshot,
                             now: Date = Date()) -> (left: String, compacted: String, week: String)? {
    var left = ""
    if let percent = snapshot.sessionPercent {
        let resets = [snapshot.sessionResetsInMin.map(formatRemaining),
                      snapshot.sessionResetsAt.map(formatClock)]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .map { " · \($0)" }
            .joined()
        left = "Session \(Int(percent.rounded()))%\(resets)"
    } else if snapshot.sessionResetsAt != nil {
        // Not dropped silently: the row would lose its left half at the very moment the waiting
        // is over. Says so until Claude's next render brings a fresh percentage.
        left = "Limit reset"
    }

    var compactedText = ""
    if let compacted = snapshot.compacted {
        let budget = snapshot.compactBudget.map { "/\($0)" } ?? ""
        let auto = (snapshot.compactAuto ?? 0) > 0 ? " (\(snapshot.compactAuto!) auto)" : ""
        compactedText = "Compacted \(compacted)\(budget)\(auto)"
    }

    var weekText = ""
    if let week = snapshot.weekPercent {
        let resets = snapshot.weekResetsAt.map { " · \($0)" } ?? ""
        weekText = "Week \(Int(week.rounded()))%\(resets)"
    }

    if left.isEmpty && compactedText.isEmpty && weekText.isEmpty { return nil }
    return (left, compactedText, weekText)
}

// MARK: - What is remembered between sessions

/// The account's rate limits, which belong to no single tab.
///
/// Claude Code leaves `rate_limits` out of its status line payload until a request has been made
/// in that process, so the first snapshot after `--continue` carries no Session and no Week — and
/// it overwrites the tab's previous one. These fields are what puts the row back.
public struct RememberedLimits: Codable, Equatable {
    public var sessionPercent: Double?
    public var sessionResetsAt: Double?
    public var sessionResetsInMin: Int?
    public var weekPercent: Double?
    public var weekResetsAt: String?
    public var updatedAt: Double = 0

    public init() {}
}

/// The limit fields worth keeping, or nil when the snapshot has none — a snapshot without them
/// must never erase what another one already knew.
public func limitFields(of snapshot: StatusLineSnapshot) -> RememberedLimits? {
    guard snapshot.sessionPercent != nil || snapshot.weekPercent != nil else { return nil }
    var limits = RememberedLimits()
    limits.sessionPercent = snapshot.sessionPercent
    limits.sessionResetsAt = snapshot.sessionResetsAt
    limits.sessionResetsInMin = snapshot.sessionResetsInMin
    limits.weekPercent = snapshot.weekPercent
    limits.weekResetsAt = snapshot.weekResetsAt
    limits.updatedAt = snapshot.updatedAt
    return limits
}

/// Fills only the fields the snapshot does not have — a live value always beats a remembered one.
///
/// `applyResetWindow` runs afterwards, because a remembered "resets in 84 min" is a lie an hour
/// later and the rule for that lives in one tested place.
public func applyingLimits(_ limits: RememberedLimits?, to snapshot: StatusLineSnapshot,
                           now: Double = Date().timeIntervalSince1970 * 1000) -> StatusLineSnapshot {
    guard let limits else { return snapshot }
    var merged = snapshot

    // A remembered window that has already passed is old news, not news. Filling it in would put
    // "Limit reset" in the row — which is meant for the moment a *live* percentage runs out, not
    // for a five-hour window that ended yesterday.
    let sessionAlive = (limits.sessionResetsAt ?? 0) * 1000 > now
    if sessionAlive {
        if merged.sessionPercent == nil { merged.sessionPercent = limits.sessionPercent }
        if merged.sessionResetsAt == nil { merged.sessionResetsAt = limits.sessionResetsAt }
        if merged.sessionResetsInMin == nil { merged.sessionResetsInMin = limits.sessionResetsInMin }
    }
    if merged.weekPercent == nil { merged.weekPercent = limits.weekPercent }
    if merged.weekResetsAt == nil { merged.weekResetsAt = limits.weekResetsAt }

    let windowed = applyResetWindow(
        LimitFields(sessionPercent: merged.sessionPercent,
                    sessionResetsAt: merged.sessionResetsAt,
                    sessionResetsInMin: merged.sessionResetsInMin), now: now)
    merged.sessionPercent = windowed.sessionPercent
    merged.sessionResetsAt = windowed.sessionResetsAt
    merged.sessionResetsInMin = windowed.sessionResetsInMin
    return merged
}

/// Gives the bar a scale before Claude reports one. The **usage** is never taken from memory: a
/// fresh session really is at zero, and the previous session's tokens would be a lie rather than
/// a placeholder.
public func applyingWindowSize(_ snapshot: StatusLineSnapshot,
                               remembered: StatusLineSnapshot?) -> StatusLineSnapshot {
    guard snapshot.totalTokens <= 0, let remembered, remembered.totalTokens > 0
    else { return snapshot }
    var filled = snapshot
    filled.totalTokens = remembered.totalTokens
    filled.usedPercent = (Double(snapshot.usedTokens) / Double(remembered.totalTokens) * 1000)
        .rounded() / 10
    return filled
}

/// File name for a directory's remembered snapshot. Hashed rather than escaped, so a path with
/// separators in it cannot climb out of the directory; collapsed first, so `/Users/x/p` and `~/p`
/// are one key. Port of `hashCwd` in `app/src/host/statusLineWatcher.ts:38`.
public func cwdKey(_ cwd: String, home: String = NSHomeDirectory()) -> String {
    let digest = Insecure.SHA1.hash(data: Data(collapseHome(cwd, home: home).utf8))
    return String(digest.map { String(format: "%02x", $0) }.joined().prefix(16))
}

/// Where the remembered files live, beside the per-tab snapshots.
public func rememberedDir(_ dir: String = statusLineDir()) -> String { dir + "/last" }

/// The account's remembered limits, or nil when nothing has been written yet.
public func readRememberedLimits(dir: String = statusLineDir()) -> RememberedLimits? {
    guard let data = FileManager.default.contents(atPath: rememberedDir(dir) + "/limits.json")
    else { return nil }
    return try? JSONDecoder().decode(RememberedLimits.self, from: data)
}

/// The last snapshot seen for a working directory.
public func readRememberedSnapshot(cwd: String?, dir: String = statusLineDir()) -> StatusLineSnapshot? {
    guard let cwd, !cwd.isEmpty,
          let data = FileManager.default.contents(atPath: "\(rememberedDir(dir))/\(cwdKey(cwd)).json")
    else { return nil }
    return try? JSONDecoder().decode(StatusLineSnapshot.self, from: data)
}

/// What the window draws for a tab: what the producer wrote, plus what it could not know.
public func resolvedSnapshot(_ written: StatusLineSnapshot,
                             dir: String = statusLineDir()) -> StatusLineSnapshot {
    applyingLimits(readRememberedLimits(dir: dir),
                   to: applyingWindowSize(written,
                                          remembered: readRememberedSnapshot(cwd: written.cwd, dir: dir)))
}

// MARK: - Writing and reading the snapshot file

/// Writes through a temporary file and renames: a half-written snapshot must never be what the
/// window reads.
public func writeSnapshot(_ snapshot: StatusLineSnapshot, dir: String, tabId: String) throws {
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true,
                                            attributes: [.posixPermissions: 0o700])
    let data = try JSONEncoder().encode(snapshot)
    let temp = "\(dir)/.\(tabId).tmp"
    try data.write(to: URL(fileURLWithPath: temp), options: .atomic)
    _ = try? FileManager.default.removeItem(atPath: "\(dir)/\(tabId).json")
    try FileManager.default.moveItem(atPath: temp, toPath: "\(dir)/\(tabId).json")
}

public func readSnapshot(dir: String, tabId: String) -> StatusLineSnapshot? {
    guard let data = FileManager.default.contents(atPath: "\(dir)/\(tabId).json") else { return nil }
    return try? JSONDecoder().decode(StatusLineSnapshot.self, from: data)
}

/// The whole producer, as one call. Returns false when the environment does not name a target —
/// which is the normal case outside a panel tab, not an error.
@discardableResult
public func runStatusLineProducer(environment: [String: String] = ProcessInfo.processInfo.environment,
                                  stdin: FileHandle = .standardInput) -> Bool {
    guard let dir = environment[statusDirKey], let tabId = environment[statusTabKey],
          !dir.isEmpty, !tabId.isEmpty else { return false }
    guard let data = try? stdin.readToEnd(), !data.isEmpty,
          let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return false }

    let budget = Int(environment[statusBudgetKey] ?? "") ?? 0
    // A broken status line must not disturb the session: every failure here is silent.
    try? writeSnapshot(buildSnapshot(payload, budget: budget), dir: dir, tabId: tabId)

    if let delegate = environment[statusDelegateKey], !delegate.isEmpty {
        runDelegate(delegate, input: data, environment: environment)
    }
    return true
}

/// The user's own statusLine command, run afterwards for its side effects — notifications and
/// such. Its output is discarded: the window draws the row.
private func runDelegate(_ command: String, input: Data, environment: [String: String]) {
    var env = environment
    for key in [statusDirKey, statusTabKey, statusBudgetKey, statusDelegateKey] {
        env.removeValue(forKey: key)
    }

    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/sh")
    process.arguments = ["-c", command]
    process.environment = env
    let pipe = Pipe()
    process.standardInput = pipe
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice

    guard (try? process.run()) != nil else { return }
    try? pipe.fileHandleForWriting.write(contentsOf: input)
    try? pipe.fileHandleForWriting.close()
    process.waitUntilExit()
}
