import Foundation

/// The display name a panel tab starts Claude Code with (`claude -n <name>`), and the session id
/// it hands to `--session-id`.
///
/// Several Claudes run at once on this machine and the `/resume` picker shows them side by side,
/// so a name has to say both "this one is the panel" and "this one was working on X". The old
/// format `figma-claude:<file>` said only that much — and said it again for every tab on the same
/// file, for every Restart, and after every app launch. Four sessions ended up named
/// `figma-claude:Designdone`.
///
/// So the name carries the session's own id: `fc-<file slug>-<first 8 of the uuid>`. The host
/// mints the uuid, passes it as `--session-id`, and the name then points at the real
/// `~/.claude/projects/<slug>/<uuid>.jsonl` rather than merely looking unique.
///
/// The Figma file still wins over the working directory — two tabs on the same project are the
/// normal case, and now they are told apart by the id rather than by the file name.
///
/// `app/src/lib/session-name.ts` (the Electron host) deliberately stays on the old format; it is
/// not the app that runs. The two are no longer expected to match.

/// Prefix every panel session carries.
public let sessionNamePrefix = "fc"

/// Long names are truncated in the prompt box anyway; this keeps the slug readable there.
private let maxSuffix = 40

/// The daemon reports the browser page title, which Figma suffixes with " – Figma". In a name
/// that is already about Figma, that word is noise. Port of `cleanFileName` in `figma-status.ts`.
public func cleanFileName(_ title: String?) -> String {
    guard let title else { return "" }
    let pattern = "\\s*[–—-]\\s*Figma\\s*$"
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return title }
    let range = NSRange(title.startIndex..., in: title)
    let stripped = regex.stringByReplacingMatches(in: title, range: range, withTemplate: "")
    return stripped.trimmingCharacters(in: .whitespacesAndNewlines)
}

/// One lowercase, hyphen-joined piece of a session name.
///
/// Folding the diacritics first is what keeps a German file name legible — "Übersicht" becomes
/// `ubersicht`, not `bersicht`. Anything the fold does not reduce to ASCII (CJK, emoji, the
/// zero-width characters that survive a copy out of Figma) drops out, which is why every caller
/// has to cope with an empty result.
public func sessionSlug(_ raw: String) -> String {
    // "ß" is no diacritic, so the fold drops it and "Größen" would break into "gro-en". The other
    // German vowels stay single letters — "ubersicht" reads fine, "uebersicht" does not.
    let sharpS = raw.replacingOccurrences(of: "ß", with: "ss")
        .replacingOccurrences(of: "ẞ", with: "ss")
    let folded = sharpS.folding(options: [.diacriticInsensitive, .widthInsensitive],
                                locale: Locale(identifier: "en_US_POSIX")).lowercased()
    var out = ""
    var pendingSeparator = false
    for scalar in folded.unicodeScalars {
        let isKept = (scalar.value >= 97 && scalar.value <= 122)   // a-z
            || (scalar.value >= 48 && scalar.value <= 57)          // 0-9
        if isKept {
            if pendingSeparator, !out.isEmpty { out.append("-") }
            pendingSeparator = false
            out.unicodeScalars.append(scalar)
            if out.count >= maxSuffix { break }
        } else {
            pendingSeparator = true
        }
    }
    return out
}

/// The first block of a uuid — enough to find the session file, short enough for the prompt box.
public func shortSessionId(_ uuid: String) -> String {
    String(uuid.trimmingCharacters(in: .whitespaces).prefix(8)).lowercased()
}

public func panelSessionName(file: String? = nil, cwd: String? = nil,
                             sessionId: String = "") -> String {
    var middle = sessionSlug(cleanFileName(file))

    // `basename("/")` is "/" and `basename("")` is "" — neither says anything about the session,
    // and both slug to nothing anyway.
    if middle.isEmpty, let cwd {
        let trimmed = cwd.trimmingCharacters(in: .whitespaces)
        middle = sessionSlug((trimmed as NSString).lastPathComponent)
    }

    let parts = [sessionNamePrefix, middle, shortSessionId(sessionId)].filter { !$0.isEmpty }
    return parts.joined(separator: "-")
}

/// Whether a spawn starts a conversation of its own, and so deserves a fresh name and id.
///
/// `--resume` and `--continue` adopt an existing session. Passing `-n` alongside them renames
/// whatever the user picked — that is how one session on disk ended up carrying two names — and
/// `--session-id` would be claiming an id the conversation already has.
public func startsANewSession(extraArgs: [String]) -> Bool {
    let adopting: Set<String> = ["--resume", "-r", "--continue", "-c"]
    return !extraArgs.contains { adopting.contains($0) }
}
