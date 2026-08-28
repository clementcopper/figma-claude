import Foundation

// The small pure modules from `app/src/lib/`, kept together because each is a handful of lines:
// theme-choice, limit-window, pty-exit, render-undo, about-panel, project-layout.

// MARK: - Which palette the window uses (theme-choice.ts)

public enum ThemeSetting: String { case system, light, dark }
public enum Theme: String { case light, dark }

/// One tiny crossing of two inputs — the user's setting and what macOS currently is — but it is
/// the only place they meet, and it decides what every surface looks like.
public func resolveTheme(setting: ThemeSetting?, systemPrefersDark: Bool) -> Theme {
    switch setting {
    case .light: return .light
    case .dark: return .dark
    // 'system' and anything unrecognised: follow macOS, which is what a Mac app is expected to do.
    case .system, nil: return systemPrefersDark ? .dark : .light
    }
}

// MARK: - Keeping the five-hour limit row honest (limit-window.ts)

public struct LimitFields: Equatable {
    public var sessionPercent: Double?
    public var sessionResetsAt: Double?
    public var sessionResetsInMin: Int?

    public init(sessionPercent: Double? = nil, sessionResetsAt: Double? = nil,
                sessionResetsInMin: Int? = nil) {
        self.sessionPercent = sessionPercent
        self.sessionResetsAt = sessionResetsAt
        self.sessionResetsInMin = sessionResetsInMin
    }
}

/// A snapshot only arrives when Claude renders, so a remembered "resets in 84 min" is a lie an
/// hour later. `sessionResetsAt` is an absolute point, so the remaining minutes can be recomputed
/// without Claude — which matters most exactly when the limit is spent and nothing renders.
///
/// `sessionResetsAt` deliberately survives the reset: the UI shows "Limit reset" from a point in
/// the past, and dropping the field would take that state away at the moment the waiting is over.
///
/// - Parameter now: milliseconds since the epoch, passed in so the boundary can be tested.
public func applyResetWindow(_ snapshot: LimitFields, now: Double) -> LimitFields {
    var out = snapshot

    guard let resetsAt = out.sessionResetsAt else {
        out.sessionResetsInMin = nil
        return out
    }

    let minutes = Int(((resetsAt * 1000 - now) / 60000).rounded())
    if minutes <= 0 {
        out.sessionPercent = nil
        out.sessionResetsInMin = nil
        return out
    }

    out.sessionResetsInMin = minutes
    return out
}

// MARK: - What to write into a tab when its process is gone (pty-exit.ts)

/// How long a process may live and still count as "died on startup".
private let immediateMs: Double = 1000

/// One shape of failure deserves more than a number: the process died instantly, with code 1, and
/// never printed a thing. `[Process exited with code 1]` on its own reads like a broken `claude`
/// or a broken PATH, and both send you looking in the wrong place. The one cause seen so far is a
/// stale instance — the bundle in /Applications replaced while the app was running.
public func describePtyExit(code: Int32, msSinceSpawn: Double, sawOutput: Bool) -> String {
    let line = "\r\n[Process exited with code \(code)]\r\n"

    if code == 1 && !sawOutput && msSinceSpawn < immediateMs {
        return line
            + "\r\nIt printed nothing before exiting. If FigmaClaude was reinstalled while running,\r\n"
            + "quit it and open it again — a replaced bundle breaks the terminals of the old instance.\r\n"
    }

    return line
}

// MARK: - Undoing the last render without the CLI (render-undo.ts)

public struct CreatedNode: Equatable {
    public var id: String
    public var name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

public let lastRenderFile = NSHomeDirectory() + "/.figma-ds-cli/last-render.json"

/// Reads the state file's content. Anything malformed means "nothing to undo", never a crash.
public func parseLastRender(_ raw: String?) -> [CreatedNode] {
    guard let raw, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          let data = raw.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let nodes = object["nodes"] as? [[String: Any]]
    else { return [] }

    return nodes.compactMap { node in
        guard let id = node["id"] as? String else { return nil }
        return CreatedNode(id: id, name: node["name"] as? String ?? "")
    }
}

/// The same removal loop `figma-cli undo` runs — one round trip, ids only. Nothing is searched
/// for or guessed, so the button can never touch anything else on the canvas.
public func buildUndoEval(ids: [String]) -> String {
    let list = (try? JSONSerialization.data(withJSONObject: ids)).map { String(decoding: $0, as: UTF8.self) } ?? "[]"
    return """
    (async () => {
      let removed = 0;
      const names = [];
      for (const id of \(list)) {
        const node = await figma.getNodeByIdAsync(id);
        if (node && !node.removed) { names.push(node.name); node.remove(); removed++; }
      }
      return { removed, names };
    })()
    """
}

/// What the button says — it names the count, so a stale state file is visible before the click.
public func undoLabel(_ nodes: [CreatedNode]) -> String {
    if nodes.isEmpty { return "Nothing to undo" }
    if nodes.count == 1 {
        return "Undo last render (\(nodes[0].name.isEmpty ? "1 node" : nodes[0].name))"
    }
    return "Undo last render (\(nodes.count) nodes)"
}

/// What the popover reports afterwards.
public func undoMessage(removed: Int, names: [String]) -> String {
    if removed == 0 { return "Nothing to undo — the nodes are already gone" }
    let kept = names.filter { !$0.isEmpty }
    let what = kept.isEmpty ? "\(removed) nodes" : kept.joined(separator: ", ")
    return "Removed \(what)"
}

// MARK: - The About dialog's credits (about-panel.ts)

private let provenance = "Ported from clementcopper/claude-terminal-panel"

/// The version out of `figma-cli --version`, or nil when the output is not one.
///
/// Commander prints it bare (`2.1.2`), but nothing guarantees that: a wrapper may add a banner,
/// and a failed spawn puts a shell error on stdout. The last non-empty line is taken and it has
/// to look like a version, otherwise the dialog would show "command not found" as a number.
public func parseCliVersion(_ stdout: String) -> String? {
    let stripped = stdout.replacingOccurrences(
        of: "\u{001B}\\[[0-9;]*[A-Za-z]", with: "", options: .regularExpression)
    let lines = stripped.split(separator: "\n")
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }

    guard let last = lines.last,
          let range = last.range(of: "\\b\\d+\\.\\d+\\.\\d+([-+][0-9A-Za-z.-]+)?\\b",
                                 options: .regularExpression)
    else { return nil }
    return String(last[range])
}

/// An em dash rather than a hidden line when there is no version — "figma-cli —" says the panel
/// looked and found nothing. Omitting the row would read as "there is no CLI involved".
public func aboutCredits(cliVersion: String?) -> String {
    "figma-cli \(cliVersion ?? "—")\n\(provenance)"
}

// MARK: - Where FigmaClaude puts things in a user's project (project-layout.ts)

/// Folder for everything the CLI generates in a project. Visible, not `.figmaclaude/`: the CLI's
/// own `locateDesignMd` skips dot-directories, so a hidden folder would make DESIGN.md invisible
/// to `spec` and `instantiate`.
public let outputDir = "FigmaClaude"

/// Where the agent rules live, relative to the project root. Claude Code reads `CLAUDE.md` and
/// `.claude/rules/`, and *not* `AGENTS.md`.
public let rulesFile = ".claude/rules/figma-cli.md"

/// First line of the ruleset — how the file is recognised as the CLI's.
public let rulesMarker = "# Using figma-cli"

/// Is the ruleset in place? Content, not existence: an empty or foreign file is not ours.
public func rulesInstalled(_ content: String?) -> Bool {
    guard let content else { return false }
    return content.contains(rulesMarker)
}

/// A path inside the output folder, for the commands that take one.
public func outputPath(_ segments: String...) -> String {
    ([outputDir] + segments).joined(separator: "/")
}
