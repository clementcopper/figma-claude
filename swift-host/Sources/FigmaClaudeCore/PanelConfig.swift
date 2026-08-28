import Foundation

/// The panel's configuration, read from the same file the Electron host uses.
///
/// `~/.figma-ds-cli/panel.json`, same keys, same defaults — a config written by either host works
/// in the other. That is deliberate: while both exist, switching between them must not mean
/// re-picking a working directory or re-binding a Figma file.
public struct PanelConfig: Decodable {
    public var command: String = "claude"
    public var args: [String] = []
    public var shell: String = ""
    public var env: [String: String] = [:]
    public var directMode: Bool = true
    public var cwd: String = ""
    public var statusLine: Bool = true
    public var figmaFile: String = ""
    /// An explicit command or a path to a checkout, when the CLI is not on the PATH.
    public var figmaCli: String = ""
    public var theme: String = "system"

    /// Synthesised memberwise init is internal, and `Decodable` suppresses the empty one — the
    /// defaults above are only reachable from outside with this.
    public init() {}

    public static let path = NSHomeDirectory() + "/.figma-ds-cli/panel.json"

    public static func load(from path: String = PanelConfig.path) -> PanelConfig {
        guard let data = FileManager.default.contents(atPath: path) else { return PanelConfig() }
        // A config that does not parse is a config the user can fix; falling back to the defaults
        // beats refusing to start with a window nobody can read the error in.
        return (try? JSONDecoder().decode(PanelConfig.self, from: data)) ?? PanelConfig()
    }

    /// Expands a leading `~` and requires the directory to exist, like `resolveConfiguredCwd`
    /// does in `ptyManager.ts`. An empty or missing directory means "decide elsewhere".
    public func resolvedCwd() -> String? {
        let raw = cwd.trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return nil }
        let expanded = raw == "~" || raw.hasPrefix("~/")
            ? NSHomeDirectory() + String(raw.dropFirst())
            : raw
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: expanded, isDirectory: &isDirectory),
              isDirectory.boolValue else { return nil }
        return expanded
    }
}

/// Where FigmaClaude writes the `figma-cli` launcher when the CLI is a checkout rather than an
/// install. Port of `shimDir` in `cli-shim.ts`.
public func shimDir(home: String = NSHomeDirectory()) -> String {
    "\(home)/.figma-ds-cli/bin"
}

/// Everything a panel terminal's process should see, assembled the way `buildEnvironment` does.
public func panelEnvironment(config: PanelConfig, home: String = NSHomeDirectory(),
                             tabId: String? = nil) -> [String: String] {
    var env = ProcessInfo.processInfo.environment

    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env["FORCE_COLOR"] = "1"

    // An app started from the Dock inherits launchd's PATH, which holds neither `claude` nor
    // anything installed by npm or Homebrew. Asking the login shell once settles it.
    if let loginPath = LoginShellPath.resolve() {
        env["PATH"] = loginPath
    }
    env["PATH"] = pathWithShim(env["PATH"] ?? "", dir: shimDir(home: home))

    // How an agent tells "I am running inside the panel" from "I am in a normal terminal".
    env["FIGMACLAUDE"] = "1"

    // The file the panel bound the daemon to. Without it a command from Claude's terminal talks
    // to whichever file the daemon happened to pick first, which is silently the wrong one when
    // several are open.
    if config.figmaFile.isEmpty {
        env.removeValue(forKey: "FIGMA_FILE")
    } else {
        env["FIGMA_FILE"] = config.figmaFile
    }

    // The status line producer has no other way to say which tab it belongs to: Claude Code
    // hands it the session data on stdin, and the host only ever sees PTY bytes. These two
    // variables are the whole contract.
    if config.statusLine, let tabId, !tabId.isEmpty {
        env[statusTabKey] = tabId
        env[statusDirKey] = statusLineDir()
    } else {
        env.removeValue(forKey: statusTabKey)
        env.removeValue(forKey: statusDirKey)
    }

    for (key, value) in config.env { env[key] = value }
    return env
}

/// The arguments a tab starts Claude Code with. A `-n` the user put in `panel.json` wins — this
/// only fills a gap, like `withSessionName` in `ptyManager.ts`.
public func panelArguments(config: PanelConfig, sessionName: String,
                           statusLineCommand: String? = nil) -> [String] {
    var args = config.args
    let runsClaude = (config.command as NSString).lastPathComponent
        .replacingOccurrences(of: "\\.(exe|cmd|bat)$", with: "", options: .regularExpression) == "claude"
    guard runsClaude, config.directMode, !sessionName.isEmpty else { return args }
    guard !args.contains("-n"), !args.contains("--name") else { return args }
    args.append(contentsOf: ["-n", sessionName])

    // Handed over per session, so nothing in the user's own ~/.claude/settings.json changes and
    // their status line keeps behaving exactly as before outside the panel.
    if config.statusLine, let command = statusLineCommand, !command.isEmpty,
       let settings = try? JSONSerialization.data(
        withJSONObject: ["statusLine": ["type": "command", "command": command]]) {
        args.append(contentsOf: ["--settings", String(decoding: settings, as: UTF8.self)])
    }
    return args
}
