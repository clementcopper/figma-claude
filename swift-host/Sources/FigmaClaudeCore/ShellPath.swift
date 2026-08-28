import Foundation

/// Working out the PATH a terminal should have.
///
/// Port of `app/src/lib/shell-path.ts`, including the subtlety that cost an afternoon there: a
/// **login** shell is not enough. zsh reads `.zshenv` and `.zprofile` for a login shell, but
/// `.zshrc` only when it is interactive — and `.zshrc` is where installers put their line. Claude
/// Code's own installer writes `export PATH="$HOME/.local/bin:$PATH"` there, so probing with
/// `zsh -l -c` returns a PATH without `claude` in it.
///
/// Hence: probe interactively, and read the answer back through a marker, because an interactive
/// shell may print a banner, a version notice or a prompt into the same stream.

public let pathMarker = "__FIGMACLAUDE_PATH__"

public func pathProbeCommand() -> String {
    "printf '%s%s\\n' '\(pathMarker)' \"$PATH\""
}

/// Pulls the PATH back out of the probe's output, ignoring banners around it.
public func extractProbedPath(_ stdout: String) -> String? {
    guard let line = stdout.split(separator: "\n", omittingEmptySubsequences: false)
        .reversed()
        .first(where: { $0.contains(pathMarker) })
    else { return nil }

    guard let range = line.range(of: pathMarker) else { return nil }
    let value = line[range.upperBound...].trimmingCharacters(in: .whitespaces)
    return value.contains("/") ? value : nil
}

/// The directories a user's tools live in even when no shell file mentions them. Appended, never
/// prepended: whatever the shell said comes first, so the user's own order wins.
public func withUserBinDirs(_ path: String, home: String) -> String {
    var parts = path.split(separator: ":").map(String.init).filter { !$0.isEmpty }
    for dir in ["\(home)/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"] where !parts.contains(dir) {
        parts.append(dir)
    }
    return parts.joined(separator: ":")
}

/// PATH with the shim directory in front, without duplicating it on a second start.
public func pathWithShim(_ path: String, dir: String) -> String {
    var parts = path.split(separator: ":").map(String.init).filter { !$0.isEmpty }
    if parts.first == dir { return path }
    parts.removeAll { $0 == dir }
    return ([dir] + parts).joined(separator: ":")
}

/// Where a bare command name would be found. Returns nil when it is nowhere on the PATH — worth
/// saying out loud, because the alternative is a terminal that exits 1 in silence.
public func whichOnPath(_ command: String, path: String,
                        exists: (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) }) -> String? {
    // Already a path: the shell would not search for it either.
    if command.contains("/") { return exists(command) ? command : nil }

    for dir in path.split(separator: ":") where !dir.isEmpty {
        let candidate = "\(dir)/\(command)"
        if exists(candidate) { return candidate }
    }
    return nil
}

/// Asks the login shell, interactively, what a real terminal's PATH looks like. Cached: the
/// probe spawns a shell that may read a full rc file, and doing that per tab is waste.
public enum LoginShellPath {
    private static var cached: String?

    public static func resolve(timeout: TimeInterval = 5) -> String? {
        if let cached { return cached }

        let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: shell)
        // `-i` as well as `-l`: see the note above. Without it `claude` is not on the answer.
        process.arguments = ["-ilc", pathProbeCommand()]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
        } catch {
            return nil
        }

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        guard let probed = extractProbedPath(String(decoding: data, as: UTF8.self)) else { return nil }
        let home = NSHomeDirectory()
        cached = withUserBinDirs(probed, home: home)
        return cached
    }
}
