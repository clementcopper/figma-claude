import Foundation

/// Bytes on the PTY, readable — the measurement behind every keyboard complaint.
///
/// "⌃C writes a c" (Daniel, 2026-10-03) can mean three different things: SwiftTerm sent the
/// letter, SwiftTerm sent a kitty-protocol sequence Claude Code read as the letter, or Claude
/// Code dropped the modifier itself. Reading the bytes settles it; guessing from the symptom did
/// not. `FIGMACLAUDE_KEYLOG=<path>` makes the terminal view append one line per outgoing chunk
/// and one per kitty negotiation it sees coming in.

/// `1b 5b 39 39 3b 35 75  "ESC[99;5u"` — hex, then the bytes as text with controls spelled out.
public func hexLine(_ bytes: [UInt8]) -> String {
    let hex = bytes.map { String(format: "%02x", $0) }.joined(separator: " ")
    var text = ""
    for b in bytes {
        switch b {
        case 0x1b: text += "ESC"
        case 0x0d: text += "CR"
        case 0x0a: text += "LF"
        case 0x09: text += "TAB"
        case 0x7f: text += "DEL"
        case 0x00..<0x20: text += "^" + String(UnicodeScalar(b + 0x40))
        case 0x20..<0x7f: text += String(UnicodeScalar(b))
        default: text += "·"
        }
    }
    return "\(hex)  \"\(text)\""
}

/// The kitty keyboard protocol's four CSI … u forms, as they appear in a chunk: `ESC[?u` (query),
/// `ESC[>flagsu` (push), `ESC[<nu` (pop), `ESC[=flags;modeu` (set). SwiftTerm answers the query
/// unconditionally and switches its key encoding on any pushed flag.
public func kittyNegotiations(in bytes: [UInt8]) -> [String] {
    var found: [String] = []
    var i = 0
    while i + 2 < bytes.count {
        if bytes[i] == 0x1b && bytes[i + 1] == 0x5b, let lead = kittyLead(bytes[i + 2]) {
            var j = i + 3
            while j < bytes.count, (bytes[j] >= 0x30 && bytes[j] <= 0x39) || bytes[j] == 0x3b { j += 1 }
            if j < bytes.count && bytes[j] == 0x75 {
                found.append("ESC[" + lead + String(decoding: bytes[(i + 3)..<j], as: UTF8.self) + "u")
                i = j + 1
                continue
            }
        }
        i += 1
    }
    return found
}

private func kittyLead(_ b: UInt8) -> String? {
    switch b {
    case 0x3f: return "?"
    case 0x3e: return ">"
    case 0x3c: return "<"
    case 0x3d: return "="
    default: return nil
    }
}
