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

/// The three appearance rows, in the order they are shown. One list, so the Figma menu and the
/// menu bar cannot end up offering different words for the same setting.
public let appearanceChoices: [(setting: ThemeSetting, label: String)] = [
    (.system, "System — follow macOS"), (.light, "Light"), (.dark, "Dark")
]

// MARK: - Which connection mode the CLI is driven in

public enum FigmaMode: String, CaseIterable { case yolo, safe, browser }

/// What each mode is, in the words the menu shows.
public func modeLabel(_ mode: FigmaMode) -> String {
    switch mode {
    case .yolo: return "Yolo — patched app, CDP"
    case .safe: return "Safe — plugin, no patching"
    case .browser: return "Browser — Chromium profile"
    }
}

/// `connect`, with the flag the mode needs. Yolo is the CLI's default and takes none — port of
/// `app/src/main.ts:564`.
public func connectArguments(mode: FigmaMode?) -> [String] {
    switch mode ?? .yolo {
    case .yolo: return ["connect"]
    case .safe: return ["connect", "--safe"]
    case .browser: return ["connect", "--browser"]
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

/// What a `waitpid` status actually says.
///
/// SwiftTerm hands `processTerminated` the raw status from `waitpid(shellPid, &n, WNOHANG)`
/// unchanged (`LocalProcess.swift`), not an exit code. So a process that exits 1 arrives as
/// `1 << 8 = 256` — which is what the panel printed, and why the `code == 1` branch below could
/// never have fired since it was written.
///
/// - Returns: the exit code, and the signal that killed the process if one did. A signalled
///   process has no exit code of its own; reporting the low bits as one would invent a number.
public func exitStatus(waitStatus: Int32) -> (code: Int32, signal: Int32?) {
    let low = waitStatus & 0x7f
    // 0x7f in the low bits means stopped, not exited — not a termination this panel ever sees,
    // but reporting it as "exit code 127" would be a lie.
    if low != 0 && low != 0x7f {
        return (code: 128 + low, signal: low)
    }
    return (code: (waitStatus >> 8) & 0xff, signal: nil)
}

/// One shape of failure deserves more than a number: the process died instantly, with code 1, and
/// never printed a thing. `[Process exited with code 1]` on its own reads like a broken `claude`
/// or a broken PATH, and both send you looking in the wrong place. The one cause seen so far is a
/// stale instance — the bundle in /Applications replaced while the app was running.
/// What a tab shows instead of a terminal when its command is nowhere on the PATH. Into the
/// tab, not onto stderr: launched from the Dock nobody reads stderr, and an empty window with no
/// tab in it was the whole report.
public func missingCommandNote(command: String, configPath: String = PanelConfig.path) -> String {
    "\r\n[\(command) is not on the PATH this window sees — install it, or set \"command\" "
        + "in \(configPath). Restart tries again.]\r\n"
}

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
///
/// The panel's own version is not in here: the standard About panel draws it itself from the
/// bundle, above these lines.
public func aboutCredits(cliVersion: String?, buildDate: String? = nil) -> String {
    var lines = ["figma-cli \(cliVersion ?? "—")"]
    if let buildDate, !buildDate.isEmpty { lines.append("Built \(buildDate)") }
    return lines.joined(separator: "\n")
}

/// What the standard About panel puts in parentheses after the version — the commit the running
/// bundle was built from.
///
/// Empty when `make-app.sh` had no git to ask (a tarball, a detached build). AppKit then simply
/// leaves the parentheses off, which is the honest result: no commit is known.
public func aboutBuild(commit: String?) -> String {
    guard let commit, !commit.isEmpty, commit != "unknown" else { return "" }
    return commit
}

// MARK: - Where FigmaClaude puts things in a user's project (project-layout.ts)

/// Folder for everything the panel and the CLI put into a user's project.
///
/// Visible, not `.figmaclaude/`: the CLI's own `locateDesignMd` skips anything beginning with a
/// dot (`src/lib/design-md-locate.js`), so a hidden folder would make DESIGN.md invisible to
/// `spec` and `instantiate`.
///
/// **With the space.** This constant said `FigmaClaude` and was used nowhere, while the
/// `pre-clear` skill wrote `Figma Claude/` and the SessionStart hook looked for `FigmaClaude/` —
/// so a handoff written by a panel session would have been read from the wrong place, or not at
/// all. The spelling that is on disk and carries real history wins, and it is also the app's own
/// name since the rename. It lives here, once; the hook and the skill follow it.
public let outputDir = "Figma Claude"

/// The handoff the `pre-clear` skill writes and the SessionStart hook reads back after a
/// `/clear`. Named here so the two ends can be compared in a test rather than agreeing by
/// accident — they did not, and the failure was silent: the handoff was written every time and
/// simply never printed.
public let handoffPathForHook = outputDir + "/Sessions/HANDOFF.md"

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

/// What the output folder's README says, for a folder that would otherwise appear in someone's
/// project with no explanation of who put it there.
public let outputDirReadme = """
# Figma Claude

Written by Figma Claude.app and by figma-cli — not by hand, and not part of the project itself.

- `Sessions/HANDOFF.md` — the state the last panel session left behind. Overwritten each time;
  a `SessionStart` hook prints it into the next session after a `/clear`.
- `Sessions/YYYY-MM-DD.md` — what was decided and what stayed open, per day.
- `LEARNINGS.md` — quirks and dead ends worth not repeating.
- `DESIGN.md` — the design system read out of the Figma file by `figma-cli extract`.

Safe to delete: everything here is a record, nothing here is read back except the handoff.
"""

/// Creates the output folder in a project, so it exists before anything needs it and its name is
/// settled by code rather than by whoever writes there first.
///
/// Nothing is overwritten. A folder already in place is left alone — in a project that has been
/// used it holds Sessions, DESIGN.md and LEARNINGS.md — and the README is written only when it is
/// missing. Here rather than in the window controller so it can be run against a real temporary
/// directory in the checks: a copy of these six lines in a probe would prove the mechanism and
/// not the code that ships.
///
/// - Returns: one line for the panel's result toast.
public func prepareOutputFolder(cwd: String, fileManager: FileManager = .default) -> String {
    let sessions = (cwd as NSString).appendingPathComponent(outputPath("Sessions"))
    let readme = (cwd as NSString).appendingPathComponent(outputPath("README.md"))

    do {
        try fileManager.createDirectory(atPath: sessions, withIntermediateDirectories: true)
    } catch {
        return "Could not create \(outputDir)/: \(error.localizedDescription)"
    }

    if !fileManager.fileExists(atPath: readme) {
        try? outputDirReadme.write(toFile: readme, atomically: true, encoding: .utf8)
    }
    return "\(outputDir)/ ready — Sessions and the handoff live here"
}

/// A path inside the output folder, for the commands that take one.
///
/// The one way to build such a path. Spelling it out at a call site is how the two names came
/// apart in the first place.
public func outputPath(_ segments: String...) -> String {
    ([outputDir] + segments).joined(separator: "/")
}
