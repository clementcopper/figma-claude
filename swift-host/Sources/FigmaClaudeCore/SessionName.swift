import Foundation

/// The display name a panel tab starts Claude Code with (`claude -n <name>`).
///
/// Port of `app/src/lib/session-name.ts`, rules unchanged: several Claudes run at once on this
/// machine and the `/resume` picker shows them side by side, so a name has to say both "this one
/// is the panel" and "this one was working on X". The Figma file wins over the working directory
/// — two tabs on the same project are the normal case, two tabs on the same Figma file are not.

/// Prefix every panel session carries, and the whole name when nothing else is known.
public let sessionNamePrefix = "figma-claude"

/// Long names are truncated in the prompt box anyway; this keeps the suffix readable there.
private let maxSuffix = 40

/// C0 and C1 control characters — a stray one turns the terminal title into garbage.
private let controlScalars: CharacterSet = {
    var set = CharacterSet()
    set.insert(charactersIn: Unicode.Scalar(0)!...Unicode.Scalar(0x1F)!)
    set.insert(charactersIn: Unicode.Scalar(0x7F)!...Unicode.Scalar(0x9F)!)
    return set
}()

/// Zero-width and invisible characters. They survive a copy out of Figma and make a name that
/// looks fine but that Claude Code rejects: "That name is empty once invisible characters are
/// stripped".
private let invisibleScalars: CharacterSet = {
    var set = CharacterSet()
    set.insert(Unicode.Scalar(0x00AD)!)
    set.insert(charactersIn: Unicode.Scalar(0x200B)!...Unicode.Scalar(0x200F)!)
    set.insert(charactersIn: Unicode.Scalar(0x202A)!...Unicode.Scalar(0x202E)!)
    set.insert(charactersIn: Unicode.Scalar(0x2060)!...Unicode.Scalar(0x2064)!)
    set.insert(Unicode.Scalar(0xFEFF)!)
    return set
}()

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

private func sanitize(_ raw: String) -> String {
    let kept = raw.unicodeScalars.filter {
        !controlScalars.contains($0) && !invisibleScalars.contains($0)
    }
    let collapsed = String(String.UnicodeScalarView(kept))
        .split(whereSeparator: { $0.isWhitespace })
        .joined(separator: " ")
    if collapsed.count > maxSuffix {
        return String(collapsed.prefix(maxSuffix)).trimmingCharacters(in: .whitespaces)
    }
    return collapsed
}

public func panelSessionName(file: String? = nil, cwd: String? = nil) -> String {
    let fromFigma = sanitize(cleanFileName(file))
    if !fromFigma.isEmpty {
        return "\(sessionNamePrefix):\(fromFigma)"
    }

    // `basename("/")` is "/" and `basename("")` is "" — neither says anything about the session.
    if let cwd {
        let trimmed = cwd.trimmingCharacters(in: .whitespaces)
        let fromCwd = sanitize((trimmed as NSString).lastPathComponent)
        if !fromCwd.isEmpty, fromCwd != "/", fromCwd != "." {
            return "\(sessionNamePrefix):\(fromCwd)"
        }
    }

    return sessionNamePrefix
}
