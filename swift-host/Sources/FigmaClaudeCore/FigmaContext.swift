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

    public static let empty = FigmaSnapshot(
        status: toStatusView(nil), health: nil, file: "", page: "", selection: [])
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
                      evalTimeout: TimeInterval = 4) -> FigmaSnapshot {
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

    return FigmaSnapshot(status: status, health: health, file: file, page: page, selection: selection)
}

/// Polls on a timer and reports what changed, like `FigmaContextWatcher` does.
public final class FigmaWatcher {
    private let interval: TimeInterval
    private let onChange: (FigmaSnapshot) -> Void
    private let queue = DispatchQueue(label: "de.designdone.figmaclaude.figma-poll")
    private var timer: DispatchSourceTimer?
    private var firstPoll: DispatchSemaphore?

    public private(set) var snapshot: FigmaSnapshot = .empty

    public init(interval: TimeInterval = 2.5, onChange: @escaping (FigmaSnapshot) -> Void) {
        self.interval = interval
        self.onChange = onChange
    }

    public func start() {
        guard timer == nil else { return }
        let gate = DispatchSemaphore(value: 0)
        firstPoll = gate

        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: interval)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            let next = pollFigma()
            let changed = next != self.snapshot
            self.snapshot = next
            gate.signal()
            if changed {
                DispatchQueue.main.async { self.onChange(next) }
            }
        }
        timer.resume()
        self.timer = timer
    }

    public func stop() {
        timer?.cancel()
        timer = nil
    }

    /// Waits for the first poll to land, capped.
    ///
    /// The first tab spawns right after `start()` and its session name wants the Figma file.
    /// Against a live daemon `/health` answers in a millisecond or two, so the wait is not felt;
    /// the cap is for the case where the daemon is gone, and then the working directory is the
    /// right name anyway. The Electron host learned this the hard way — without it the first tab
    /// was *always* named after the folder.
    public func waitForFirstPoll(timeout: TimeInterval = 0.6) {
        _ = firstPoll?.wait(timeout: .now() + timeout)
    }
}
