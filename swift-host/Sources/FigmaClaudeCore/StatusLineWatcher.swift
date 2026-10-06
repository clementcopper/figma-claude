import Foundation

/// Reads back what the status line producer writes.
///
/// Port of `app/src/host/statusLineWatcher.ts`. Polling rather than FSEvents on the directory:
/// the producer writes a temporary file and renames it over the old one, and a directory watch
/// reports that inconsistently — a rename is a create plus a delete plus, on some volumes,
/// nothing at all. A stat every second is cheap and never misses one.
public final class StatusLineWatcher {
    private let dir: String
    private let interval: TimeInterval
    private let onChange: (String, StatusLineSnapshot) -> Void
    private let queue = DispatchQueue(label: "de.designdone.figmaclaude.statusline")
    private var timer: DispatchSourceTimer?
    private var seen: [String: Date] = [:]
    private var snapshots: [String: StatusLineSnapshot] = [:]
    /// What survives a tab, a window and a restart: the account's limits and the last snapshot per
    /// working directory. Port of the `last/` directory in `app/src/host/statusLineWatcher.ts:57`.
    private var lastDir: String { rememberedDir(dir) }

    public init(dir: String = statusLineDir(), interval: TimeInterval = 1.0,
                onChange: @escaping (String, StatusLineSnapshot) -> Void) {
        self.dir = dir
        self.interval = interval
        self.onChange = onChange
    }

    public func snapshot(for tabId: String) -> StatusLineSnapshot? {
        queue.sync { snapshots[tabId] }
    }

    /// What a tab should show until Claude renders in it — which is after its first output, so
    /// without this the row appears seconds late and changes the terminal's height while the user
    /// is already typing. The remembered snapshot for this directory, or at least its path.
    public func initialSnapshot(cwd: String) -> StatusLineSnapshot? {
        guard !cwd.isEmpty else { return nil }
        return queue.sync {
            var base = readRememberedSnapshot(cwd: cwd, dir: dir) ?? {
                var empty = StatusLineSnapshot()
                empty.cwd = collapseHome(cwd)
                return empty
            }()
            base = applyingLimits(readRememberedLimits(dir: dir), to: base)
            return base
        }
    }

    public func start() {
        guard timer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: interval)
        timer.setEventHandler { [weak self] in self?.scan() }
        timer.resume()
        self.timer = timer
    }

    public func stop() {
        timer?.cancel()
        timer = nil
    }

    /// Forgets a tab's snapshot and removes its file — a closed tab's numbers must not reappear
    /// under a later tab that happens to reuse the id.
    public func forget(_ tabId: String) {
        queue.async {
            self.seen.removeValue(forKey: tabId)
            self.snapshots.removeValue(forKey: tabId)
            try? FileManager.default.removeItem(atPath: "\(self.dir)/\(tabId).json")
            try? FileManager.default.removeItem(atPath: "\(self.dir)/\(tabId)\(liveSuffix)")
        }
    }

    // MARK: - The remembered layer

    /// Keeps what this snapshot knows and another one may not: the account's limits, and the last
    /// state of this directory. A snapshot without limits leaves the remembered ones alone.
    private func remember(_ snapshot: StatusLineSnapshot) {
        // Never backwards. The first scan reads every file in the directory, in whatever order
        // the file system hands them over — without this the oldest one could be the one that
        // ends up remembered, and a fresh tab would start from a window that closed hours ago.
        if let limits = limitFields(of: snapshot),
           limits.updatedAt >= (readRememberedLimits(dir: dir)?.updatedAt ?? 0) {
            write(limits, to: "limits.json")
        }
        // No window size means Claude has not really rendered yet — remembering that would hand
        // the next tab a scale of zero.
        if let cwd = snapshot.cwd, !cwd.isEmpty, snapshot.totalTokens > 0,
           snapshot.updatedAt >= (readRememberedSnapshot(cwd: cwd, dir: dir)?.updatedAt ?? 0) {
            write(snapshot, to: "\(cwdKey(cwd)).json")
        }
    }

    /// Atomic, like `writeSnapshot` — a half-written file must never be what another window reads.
    private func write<T: Encodable>(_ value: T, to name: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        try? FileManager.default.createDirectory(atPath: lastDir, withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        try? data.write(to: URL(fileURLWithPath: "\(lastDir)/\(name)"), options: .atomic)
    }

    private func modified(_ path: String) -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date
    }

    private func scan() {
        guard let entries = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return }
        // Two files per tab: the producer's `<id>.json` and the mod's `<id>.live.json`. The tab
        // is the producer's file; the live one rides along and is never a tab of its own.
        for entry in entries where entry.hasSuffix(".json") && !entry.hasSuffix(liveSuffix) {
            let tabId = String(entry.dropLast(5))
            guard let producerModified = modified("\(dir)/\(entry)") else { continue }
            let liveModified = modified("\(dir)/\(tabId)\(liveSuffix)")
            let newest = max(producerModified, liveModified ?? .distantPast)
            if let last = seen[tabId], last >= newest { continue }
            guard let written = readSnapshot(dir: dir, tabId: tabId) else { continue }

            // What the producer could not know is filled in here: Claude Code omits the rate
            // limits until a request has been made, so the first snapshot after `--continue`
            // would otherwise blank the Session and Week row it had a moment ago. Then the live
            // file, whose count is the newer one inside a turn.
            let snapshot = applyingLive(readLive(dir: dir, tabId: tabId),
                                        to: resolvedSnapshot(written, dir: dir))
            seen[tabId] = newest
            snapshots[tabId] = snapshot
            // The merged one: the live file's buckets and count are the newer account state.
            // Its activity never reaches a file (no coding key), and the remembered limits it
            // carries are the ones already on disk.
            remember(snapshot)
            DispatchQueue.main.async { self.onChange(tabId, snapshot) }
        }
    }
}
