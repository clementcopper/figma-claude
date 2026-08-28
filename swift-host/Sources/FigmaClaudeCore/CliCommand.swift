import Foundation

/// Which command to run when the panel needs the CLI.
///
/// Port of `app/src/lib/cli-command.ts`. Pure, because the interesting cases are the ones that
/// are tedious to reproduce: the CLI not installed globally, a GUI launch with a stunted PATH, a
/// checkout that only exists on disk.

public struct CliInvocation: Equatable {
    public enum Source: String { case configured, path, checkout, none }

    /// Program to spawn. Empty when nothing usable was found.
    public var file: String
    public var args: [String]
    public var source: Source
    /// The entry script when the CLI runs through node — what the PATH shim has to point at.
    public var entry: String?

    public init(file: String, args: [String] = [], source: Source, entry: String? = nil) {
        self.file = file
        self.args = args
        self.source = source
        self.entry = entry
    }

    public var isUsable: Bool { !file.isEmpty }
}

private let binNames = ["figma-cli", "figma-ds-cli"]

private func viaNode(_ entry: String, _ source: CliInvocation.Source) -> CliInvocation {
    CliInvocation(file: "node", args: [entry], source: source, entry: entry)
}

/// - Parameters:
///   - pathDirs: directories from PATH, in order.
///   - configured: `figmaCli` from panel.json — an explicit command or a path to a checkout.
///   - checkoutDirs: repository roots to try when nothing is installed: `repoPath` from
///     `~/.figma-cli/config.json` (fig-start writes it) and the app's own parent, since
///     FigmaClaude ships inside the CLI repo.
public func resolveCliInvocation(pathDirs: [String], configured: String? = nil,
                                 checkoutDirs: [String] = [],
                                 exists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) })
    -> CliInvocation {

    if let configured, !configured.isEmpty {
        // A checkout rather than a command: run its entry point with node.
        if configured.hasSuffix(".js") { return viaNode(configured, .configured) }
        if configured.contains("/"), exists("\(configured)/src/index.js") {
            return viaNode("\(configured)/src/index.js", .configured)
        }
        return CliInvocation(file: configured, source: .configured)
    }

    for dir in pathDirs {
        for name in binNames where exists("\(dir)/\(name)") {
            return CliInvocation(file: name, source: .path)
        }
    }

    // Last resort, and the normal case on a machine where the repo is a checkout: run it in place.
    for dir in checkoutDirs where !dir.isEmpty {
        let entry = "\(dir)/src/index.js"
        if exists(entry) { return viaNode(entry, .checkout) }
    }

    return CliInvocation(file: "", source: .none)
}

/// Quotes a path for a shell only when it needs it — an unquoted tidy path reads better.
public func shellPath(_ value: String) -> String {
    let safe = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@%+=:,./-_")
    if value.unicodeScalars.allSatisfy({ safe.contains($0) }) { return value }
    return "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
}

/// The same answer as a line a shell — or Claude's prompt — can take.
public func resolveCliCommand(pathDirs: [String], configured: String? = nil,
                              checkoutDirs: [String] = [],
                              exists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) })
    -> (command: String, source: CliInvocation.Source) {

    let found = resolveCliInvocation(pathDirs: pathDirs, configured: configured,
                                     checkoutDirs: checkoutDirs, exists: exists)
    guard found.isUsable else { return ("", .none) }
    return (([found.file] + found.args.map(shellPath)).joined(separator: " "), found.source)
}
