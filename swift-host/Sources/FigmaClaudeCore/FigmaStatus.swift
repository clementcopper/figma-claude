import Foundation

/// Turning what the daemon reports into what the panel shows.
///
/// Port of `app/src/lib/figma-status.ts`. Pure on purpose: the interesting cases — daemon down,
/// CDP down, Safe Mode, nothing selected — are exactly the ones that are tedious to reproduce
/// live.

public struct Health: Decodable, Equatable {
    public var status: String?
    public var mode: String?
    public var plugin: Bool?
    public var cdp: Bool?
    /// Pipe Mode: the daemon holds Figma's debugging pipe. True even while the document is still
    /// loading and `cdp` is not yet true — the only signal that Figma is already ours. Without
    /// decoding it the host could not tell "pipe held, connecting" from a broken connection.
    public var pipe: Bool?
    public var file: String?

    public init(status: String? = nil, mode: String? = nil,
                plugin: Bool? = nil, cdp: Bool? = nil, pipe: Bool? = nil, file: String? = nil) {
        self.status = status
        self.mode = mode
        self.plugin = plugin
        self.cdp = cdp
        self.pipe = pipe
        self.file = file
    }
}

public struct FigmaStatusView: Equatable {
    public enum State: String { case ok, off }
    /// Daemon reachable at all.
    public var daemon: State
    /// A live connection into Figma, whichever mode provides it.
    public var figma: State
    /// Yolo / Safe / Browser, as the daemon names it. Empty when unreachable.
    public var mode: String
    /// Open file the daemon is bound to.
    public var file: String
    public var tooltip: String
}

public func toStatusView(_ health: Health?) -> FigmaStatusView {
    guard let health else {
        return FigmaStatusView(daemon: .off, figma: .off, mode: "", file: "",
                               tooltip: "Daemon not running — run `figma-cli connect`")
    }

    // Either transport counts: Yolo talks CDP, Safe Mode talks to the plugin.
    let figma: FigmaStatusView.State = (health.cdp == true || health.plugin == true) ? .ok : .off
    let mode = health.mode ?? ""
    let file = cleanFileName(health.file)

    let tooltip: String
    if figma == .ok {
        tooltip = "Figma connected"
            + (mode.isEmpty ? "" : " (\(mode))")
            + (file.isEmpty ? "" : " — \(file)")
    } else {
        tooltip = "Daemon running, but no connection to Figma"
    }

    return FigmaStatusView(daemon: .ok, figma: figma, mode: mode, file: file, tooltip: tooltip)
}

public struct SelectedNode: Decodable, Equatable {
    public var id: String
    public var name: String
    public var type: String

    public init(id: String, name: String, type: String) {
        self.id = id
        self.name = name
        self.type = type
    }
}

/// Short label for the status row: what is selected, without the ids.
public func describeSelection(_ nodes: [SelectedNode], page: String? = nil) -> String {
    if nodes.isEmpty {
        if let page, !page.isEmpty { return "\(page) — nothing selected" }
        return "nothing selected"
    }
    if nodes.count == 1 { return nodes[0].name }
    return "\(nodes.count) selected: " + nodes.map(\.name).joined(separator: ", ")
}

/// What gets written into Claude's prompt. Ids are the part that matters — they are what
/// `figma-cli get`, `set` and `render --parent` take — so they are never abbreviated away.
public func selectionPromptText(_ nodes: [SelectedNode]) -> String? {
    guard !nodes.isEmpty else { return nil }
    let parts = nodes.map { "\"\($0.name)\" (\($0.type) \($0.id))" }
    return "Figma selection: " + parts.joined(separator: ", ")
}

/// The one line the connection button shows: file and page, the way Figma's own breadcrumb reads.
///
/// Both names come from the Plugin API, so this is the same string in every connection mode. The
/// fallbacks name the state instead of the file — an empty button says nothing about why it is
/// empty.
public func figmaButtonLabel(daemon: FigmaStatusView.State, figma: FigmaStatusView.State,
                             file: String, page: String) -> String {
    guard daemon == .ok else { return "offline" }
    guard figma == .ok else { return "not connected" }
    if !file.isEmpty && !page.isEmpty { return "\(file)/\(page)" }
    if !file.isEmpty { return file }
    if !page.isEmpty { return page }
    return "no file"
}

public struct StatusRow: Equatable {
    /// 'ok' green, 'warn' yellow, 'off' red — the three states `fig-status` prints.
    public enum State: String { case ok, warn, off }
    public var label: String
    public var state: State
    public var value: String

    public init(label: String, state: State, value: String) {
        self.label = label
        self.state = state
        self.value = value
    }
}

/// The status block — one dot per thing the mode can actually fail at, so a mode shows only the
/// dots it needs. Port modes (Yolo, Browser) keep a dedicated CDP dot because the debug port is
/// separately observable and Figma can run with it closed; Pipe and Safe have no port, so they
/// drop that dot and let the Daemon row carry the connection. The same readout `bin/fig-status`
/// prints, so the panel and the shell script cannot disagree on what a working connection is.
public func statusRows(figmaRunning: Bool, cdpOk: Bool, cdpPort: Int,
                       health: Health?, mode: FigmaMode) -> [StatusRow] {
    let daemonUp = health != nil
    let pluginConnected = health?.plugin == true
    let pipeHeld = health?.pipe == true
    let cdpUp = cdpOk || health?.cdp == true
    // A connection you can actually run an eval on (pipe-held-but-loading is not one yet).
    let connected = cdpUp || pluginConnected

    var rows = [
        StatusRow(label: "Figma",
                  state: figmaRunning ? .ok : .warn,
                  value: figmaRunning ? "running" : "not running"),
    ]

    // The CDP dot only where a port exists.
    switch mode {
    case .yolo, .browser:
        rows.append(StatusRow(label: "CDP",
                              state: cdpUp ? .ok : .off,
                              value: cdpUp ? "port \(cdpPort)" : "not reachable"))
    case .pipe, .safe:
        break
    }

    // The Daemon row carries the connection health, and in Pipe/Safe names the transport too
    // (there is no separate dot for it).
    let daemonState: StatusRow.State
    let daemonValue: String
    if !daemonUp {
        daemonState = .off; daemonValue = "not running"
    } else if connected {
        daemonState = .ok; daemonValue = mode.rawValue
    } else if pipeHeld {
        // Figma is held over the pipe, its document still loading — not a fault, a wait.
        daemonState = .warn; daemonValue = "pipe, connecting…"
    } else if mode == .safe {
        daemonState = .warn; daemonValue = "safe, waiting for plugin"
    } else {
        daemonState = .warn; daemonValue = "no connection to Figma"
    }
    rows.append(StatusRow(label: "Daemon", state: daemonState, value: daemonValue))
    return rows
}

/// Is Figma itself running, and does the debug port answer? Both are `pgrep`/socket probes the
/// menu needs before it can say anything useful about why there is no connection.
public func isFigmaRunning() -> Bool {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
    process.arguments = ["-x", "Figma"]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    guard (try? process.run()) != nil else { return false }
    process.waitUntilExit()
    return process.terminationStatus == 0
}

public func isCdpReachable(port: Int, timeout: TimeInterval = 0.5) -> Bool {
    guard let url = URL(string: "http://127.0.0.1:\(port)/json/version") else { return false }
    var request = URLRequest(url: url, timeoutInterval: timeout)
    request.httpMethod = "GET"

    var reachable = false
    let done = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: request) { _, response, _ in
        reachable = (response as? HTTPURLResponse)?.statusCode == 200
        done.signal()
    }.resume()
    _ = done.wait(timeout: .now() + timeout + 0.5)
    return reachable
}
