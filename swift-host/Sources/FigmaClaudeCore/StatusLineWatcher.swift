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

    public init(dir: String = statusLineDir(), interval: TimeInterval = 1.0,
                onChange: @escaping (String, StatusLineSnapshot) -> Void) {
        self.dir = dir
        self.interval = interval
        self.onChange = onChange
    }

    public func snapshot(for tabId: String) -> StatusLineSnapshot? {
        queue.sync { snapshots[tabId] }
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
        }
    }

    private func scan() {
        guard let entries = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return }
        for entry in entries where entry.hasSuffix(".json") {
            let tabId = String(entry.dropLast(5))
            let path = "\(dir)/\(entry)"
            guard let attributes = try? FileManager.default.attributesOfItem(atPath: path),
                  let modified = attributes[.modificationDate] as? Date else { continue }
            if let last = seen[tabId], last >= modified { continue }
            guard let snapshot = readSnapshot(dir: dir, tabId: tabId) else { continue }
            seen[tabId] = modified
            snapshots[tabId] = snapshot
            DispatchQueue.main.async { self.onChange(tabId, snapshot) }
        }
    }
}
