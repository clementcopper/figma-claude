import Foundation

/// Running the CLI without a terminal.
///
/// Port of the parts of `app/src/host/figmaActions.ts` the toolbar needs. The panel exists to
/// keep the terminal for Claude, so everything it does on the user's behalf — connecting, the
/// daemon, undoing the last render — runs as a plain child process with its arguments as an
/// array, no shell, output captured and reported in the UI instead of scrolling past Claude's
/// conversation.

public struct CliResult {
    public var ok: Bool
    public var output: String

    public init(ok: Bool, output: String) {
        self.ok = ok
        self.output = output
    }
}

/// Where `fig-start` records which checkout it drove, so a GUI launch can find the CLI even when
/// nothing is installed globally.
private func repoPathFromConfig() -> String? {
    let file = NSHomeDirectory() + "/.figma-cli/config.json"
    guard let data = FileManager.default.contents(atPath: file),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let path = object["repoPath"] as? String, !path.isEmpty else { return nil }
    return path
}

/// The CLI as this machine can actually run it: configured, on PATH, or a checkout in place.
public func resolveCli(appRoot: String, configured: String? = nil) -> CliInvocation {
    let path = LoginShellPath.resolve() ?? ProcessInfo.processInfo.environment["PATH"] ?? ""
    let dirs = path.split(separator: ":").map(String.init)

    // FigmaClaude ships inside the CLI repo, so the app's own parent is a candidate.
    var checkouts: [String] = []
    if let repo = repoPathFromConfig() { checkouts.append(repo) }
    checkouts.append((appRoot as NSString).deletingLastPathComponent)
    checkouts.append(NSHomeDirectory() + "/figma-cli")

    return resolveCliInvocation(pathDirs: dirs, configured: configured, checkoutDirs: checkouts)
}

/// Runs the CLI once and captures what it said. Arguments as an array, never a shell string:
/// a Figma file name with a quote in it must not become a shell injection.
@discardableResult
public func runCli(_ cli: CliInvocation, _ arguments: [String],
                   cwd: String? = nil, timeout: TimeInterval = 60) -> CliResult {
    guard cli.isUsable else {
        return CliResult(ok: false, output: "figma-cli not found — install it or set figmaCli in panel.json")
    }

    let path = LoginShellPath.resolve() ?? ProcessInfo.processInfo.environment["PATH"] ?? ""
    let resolved = cli.file.contains("/") ? cli.file : (whichOnPath(cli.file, path: path) ?? cli.file)

    let process = Process()
    process.executableURL = URL(fileURLWithPath: resolved)
    process.arguments = cli.args + arguments
    if let cwd { process.currentDirectoryURL = URL(fileURLWithPath: cwd) }
    var environment = ProcessInfo.processInfo.environment
    environment["PATH"] = path
    process.environment = environment

    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = pipe

    do {
        try process.run()
    } catch {
        return CliResult(ok: false, output: "could not start \(resolved): \(error.localizedDescription)")
    }

    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()

    // ANSI out: this text goes into a dialog, not a terminal.
    let output = String(decoding: data, as: UTF8.self)
        .replacingOccurrences(of: "\u{001B}\\[[0-9;]*[A-Za-z]", with: "", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)

    return CliResult(ok: process.terminationStatus == 0, output: output)
}

/// Undoes the last render over the daemon's `/exec` route, so the button works on a machine
/// where the CLI is only a checkout. The ids come from `last-render.json` alone — nothing is
/// searched for or guessed, so it can never touch anything else on the canvas.
public func undoLastRender() -> String {
    let raw = try? String(contentsOfFile: lastRenderFile, encoding: .utf8)
    let nodes = parseLastRender(raw)
    guard !nodes.isEmpty else { return undoMessage(removed: 0, names: []) }

    guard let reply = daemonEvaluate(buildUndoEval(ids: nodes.map(\.id)), timeout: 20),
          let data = reply.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
        // The daemon answers with the object itself rather than a JSON string for some routes;
        // reporting "nothing" here would claim the canvas is clean when it may not be.
        return "Could not reach the daemon — is Figma connected?"
    }

    let removed = object["removed"] as? Int ?? 0
    let names = object["names"] as? [String] ?? []
    if removed > 0 { try? FileManager.default.removeItem(atPath: lastRenderFile) }
    return undoMessage(removed: removed, names: names)
}
