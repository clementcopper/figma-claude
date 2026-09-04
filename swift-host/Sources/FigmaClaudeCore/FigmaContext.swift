import Foundation

/// What the panel knows about the open Figma file, polled from the CLI's own daemon.
///
/// Port of `app/src/host/figmaContext.ts`. `URLSession` where that used `fetch`; the routes,
/// the token file and the timeouts are unchanged, because the daemon on the other end is the
/// same process either host talks to.

private let daemonPort = Int(ProcessInfo.processInfo.environment["FIGMA_DAEMON_PORT"] ?? "") ?? 3456
private let tokenFile = NSHomeDirectory() + "/.figma-ds-cli/.daemon-token"

public struct FigmaSnapshot: Equatable {
    public var status: FigmaStatusView
    public var health: Health?
    public var file: String
    public var page: String
    public var selection: [SelectedNode]
    /// The two states the daemon cannot report about itself. They used to be asked only when the
    /// menu opened, which is why the toolbar could not show what the menu's three rows showed.
    public var figmaRunning: Bool = false
    public var cdpOk: Bool = false

    public static let empty = FigmaSnapshot(
        status: toStatusView(nil), health: nil, file: "", page: "", selection: [])
}

/// What a poll asks about the world outside the daemon. Injectable because the cheap answer needs
/// AppKit — `NSWorkspace` knows which applications run without starting a process — and this
/// module deliberately has none.
public struct FigmaProbes {
    public var figmaRunning: () -> Bool
    public var cdpReachable: (Int) -> Bool

    public init(figmaRunning: @escaping () -> Bool = { isFigmaRunning() },
                cdpReachable: @escaping (Int) -> Bool = { isCdpReachable(port: $0) }) {
        self.figmaRunning = figmaRunning
        self.cdpReachable = cdpReachable
    }
}

private func readToken() -> String? {
    guard let raw = try? String(contentsOfFile: tokenFile, encoding: .utf8) else { return nil }
    let token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    return token.isEmpty ? nil : token
}

/// One request against the daemon, with the token header it requires. Returns nil for every
/// failure: a daemon that is down is a normal state here, not an error worth surfacing.
private func daemonRequest(path: String, method: String = "GET",
                           body: Data? = nil, timeout: TimeInterval) -> Data? {
    guard let token = readToken(),
          let url = URL(string: "http://127.0.0.1:\(daemonPort)\(path)") else { return nil }

    var request = URLRequest(url: url, timeoutInterval: timeout)
    request.httpMethod = method
    request.setValue(token, forHTTPHeaderField: "X-Daemon-Token")
    if let body {
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }

    // The callers are a polling loop and a startup probe, both of which want an answer or
    // nothing — so the async API is collapsed onto a semaphore rather than coloured outwards.
    var result: Data?
    let done = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: request) { data, response, _ in
        if let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
            result = data
        }
        done.signal()
    }.resume()
    _ = done.wait(timeout: .now() + timeout + 0.5)
    return result
}

public func daemonHealth(timeout: TimeInterval = 1.5) -> Health? {
    guard let data = daemonRequest(path: "/health", timeout: timeout) else { return nil }
    return try? JSONDecoder().decode(Health.self, from: data)
}

/// Runs code inside Figma through the daemon — the same `/exec` route the CLI uses.
public func daemonEvaluate(_ code: String, timeout: TimeInterval = 4) -> String? {
    let payload = try? JSONSerialization.data(withJSONObject: ["action": "eval", "code": code])
    guard let payload,
          let data = daemonRequest(path: "/exec", method: "POST", body: payload, timeout: timeout)
    else { return nil }

    guard let object = try? JSONSerialization.jsonObject(with: data),
          let body = object as? [String: Any] else { return nil }
    return body["result"] as? String
}

private let selectionCode = """
return JSON.stringify({
  file: figma.root.name,
  page: figma.currentPage.name,
  selection: figma.currentPage.selection.map(n => ({ id: n.id, name: n.name, type: n.type })).slice(0, 12)
})
"""

private struct SelectionPayload: Decodable {
    var file: String?
    var page: String?
    var selection: [SelectedNode]?
}

/// One poll: the daemon's own health, and — only when Figma is actually reachable — the file,
/// page and selection from inside it.
///
/// The daemon's title is the fallback for the file name: it survives an `eval` that times out
/// mid-render, which is exactly when the panel would otherwise go blank.
public func pollFigma(healthTimeout: TimeInterval = 1.5,
                      evalTimeout: TimeInterval = 4,
                      probes: FigmaProbes = FigmaProbes()) -> FigmaSnapshot {
    let health = daemonHealth(timeout: healthTimeout)
    let status = toStatusView(health)

    var file = status.file
    var page = ""
    var selection: [SelectedNode] = []

    if status.figma == .ok, let raw = daemonEvaluate(selectionCode, timeout: evalTimeout),
       let data = raw.data(using: .utf8),
       let parsed = try? JSONDecoder().decode(SelectionPayload.self, from: data) {
        // A malformed answer is treated as "nothing selected" rather than an error state.
        if let parsedFile = parsed.file, !parsedFile.isEmpty { file = parsedFile }
        page = parsed.page ?? ""
        selection = parsed.selection ?? []
    }

    return FigmaSnapshot(status: status, health: health, file: file, page: page,
                         selection: selection,
                         figmaRunning: probes.figmaRunning(), cdpOk: probes.cdpReachable(cdpPort))
}

/// Polls on a timer and reports what changed, like `FigmaContextWatcher` does.
public final class FigmaWatcher {
    private let interval: TimeInterval
    private let probes: FigmaProbes
    /// Called on the main queue whenever a poll differs from the last one. Settable, so the owner
    /// can hand over a closure that captures it — a `let` would have to be passed before the
    /// owner's own `super.init`.
    public var onChange: (FigmaSnapshot) -> Void
    private let queue = DispatchQueue(label: "de.designdone.figmaclaude.figma-poll")
    private var timer: DispatchSourceTimer?
    /// Entered in `start`, left once, on the first poll. A group rather than a semaphore: waiting
    /// on a finished group returns at once, however many tabs ask.
    private let firstPoll = DispatchGroup()
    private var firstPollDone = false

    /// Written on the poll queue, read on the main thread — a struct with arrays in it, so the
    /// two must not overlap. A lock rather than `queue.sync`: a poll blocks its queue for up to
    /// 5.5 s when the daemon times out, and a main thread waiting on that is a frozen window.
    private let lock = NSLock()
    private var latest: FigmaSnapshot = .empty
    public var snapshot: FigmaSnapshot {
        lock.lock(); defer { lock.unlock() }
        return latest
    }

    public init(interval: TimeInterval = 2.5, probes: FigmaProbes = FigmaProbes(),
                onChange: @escaping (FigmaSnapshot) -> Void = { _ in }) {
        self.interval = interval
        self.probes = probes
        self.onChange = onChange
    }

    /// One poll, stored, reported when it differs. On the queue.
    private func poll() {
        let next = pollFigma(probes: probes)
        lock.lock()
        let changed = next != latest
        latest = next
        lock.unlock()
        if changed { DispatchQueue.main.async { self.onChange(next) } }
    }

    public func start() {
        guard timer == nil else { return }
        firstPoll.enter()

        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: interval)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            self.poll()
            // `firstPollDone` is touched on this queue only.
            if !self.firstPollDone {
                self.firstPollDone = true
                self.firstPoll.leave()
            }
        }
        timer.resume()
        self.timer = timer
    }

    public func stop() {
        timer?.cancel()
        timer = nil
    }

    /// One poll right now, outside the timer's rhythm.
    ///
    /// Every menu action changes the connection underneath — waiting up to 2.5 s for the dot and
    /// the label to catch up reads as "nothing happened". Port of the `refresh()` the Electron
    /// host calls after each action (`app/src/main.ts:549`).
    public func refresh() {
        queue.async { [weak self] in self?.poll() }
    }

    /// Waits for the first poll to land, capped.
    ///
    /// The first tab spawns right after `start()` and its session name wants the Figma file.
    /// Against a live daemon `/health` answers in a millisecond or two, so the wait is not felt;
    /// the cap is for the case where the daemon is gone, and then the working directory is the
    /// right name anyway. The Electron host learned this the hard way — without it the first tab
    /// was *always* named after the folder.
    public func waitForFirstPoll(timeout: TimeInterval = 0.6) {
        _ = firstPoll.wait(timeout: .now() + timeout)
    }
}
