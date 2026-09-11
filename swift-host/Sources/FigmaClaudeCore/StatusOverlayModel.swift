import Foundation

/// Pure decisions behind the status overlay, kept out of the AppKit view so they can be tested.

/// The line the overlay shows while an action runs, from the action's title. The titles come
/// from `runInBackground(title:)` — "Connect", "Restart daemon", and so on.
public func actionProgressText(_ title: String) -> String {
    switch title {
    case "Connect": return "Connecting…"
    case "Restart daemon": return "Restarting daemon…"
    case "Stop daemon": return "Stopping daemon…"
    default: return "\(title)…"
    }
}

/// The mode's name for a message. Short, unlike `modeLabel` (which trails "— no patch, no port").
public func modeName(_ mode: FigmaMode) -> String {
    switch mode {
    case .pipe: return "Pipe Mode"
    case .yolo: return "Yolo Mode"
    case .safe: return "Safe Mode"
    case .browser: return "Browser Mode"
    }
}

/// What an action ended in, in one plain line — composed from the daemon's own `/health`, not
/// from the CLI's stdout (which is multi-line and full of emojis Daniel reads as slop). It also
/// surfaces the next step that otherwise only shows in the Figma menu: Safe Mode's "run the
/// FigCli plugin", and Pipe Mode still loading its document.
public func actionResultLine(title: String, health: Health?) -> String {
    if title == "Stop daemon" { return "Daemon stopped" }
    guard let health else { return "Daemon not running" }

    let mode = FigmaMode(rawValue: health.mode ?? "") ?? .pipe
    let connected = health.cdp == true || health.plugin == true
    if connected {
        let file = cleanFileName(health.file)
        return file.isEmpty ? "\(modeName(mode)) connected" : "\(modeName(mode)) connected — \(file)"
    }
    if health.pipe == true { return "Pipe Mode — Figma is loading…" }
    if mode == .safe { return "Safe Mode — run the FigCli plugin in Figma" }
    return "Daemon running, no connection to Figma yet"
}

/// Strips the pictographic glyphs the CLI decorates its output with, and collapses the
/// whitespace they leave behind. Used on CLI error text before it reaches the overlay, so a
/// failure reads as a plain sentence. Covers real emoji plus the dingbats, arrows and box glyphs
/// the CLI uses (✓ ✗ → • and the ┌│└ banner) — none of which are emoji-presentation scalars, so
/// the emoji properties alone would keep them.
public func withoutEmoji(_ text: String) -> String {
    func drop(_ s: Unicode.Scalar) -> Bool {
        if s.properties.isEmoji && s.properties.isEmojiPresentation { return true }
        if s.properties.isEmojiModifier || s.properties.isEmojiModifierBase { return true }
        if s == "\u{FE0F}" { return true }  // variation selector forcing emoji presentation
        switch s.value {
        case 0x2190...0x21FF,   // Arrows (→ ← …)
             0x2500...0x257F,   // Box Drawing (┌ │ └ …)
             0x2580...0x259F,   // Block Elements
             0x25A0...0x25FF,   // Geometric Shapes (● ○ ▪ …)
             0x2600...0x26FF,   // Miscellaneous Symbols
             0x2700...0x27BF,   // Dingbats (✓ ✗ ✔ …)
             0x2022:            // Bullet •
            return true
        default:
            return false
        }
    }
    let kept = text.unicodeScalars.filter { !drop($0) }
    return String(String.UnicodeScalarView(kept))
        .replacingOccurrences(of: "[ \\t]{2,}", with: " ", options: .regularExpression)
        .replacingOccurrences(of: " +\n", with: "\n", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}
