import Foundation

/// Keeping the kitty keyboard protocol out of the PTY stream.
///
/// SwiftTerm answers `ESC[?u` unconditionally and encodes keys the kitty way the moment any
/// flag is pushed; Claude Code then receives `ESC[99;5u` for ⌃C. Whether it reads that as a
/// control key or as the letter is Claude Code's business — the host's is that the user pressed
/// ⌃C and a "c" appeared (2026-10-03). Stripping the four negotiation forms before SwiftTerm
/// sees them keeps everything in the legacy encoding that every program understands.
///
/// Chunk boundaries: a sequence can arrive split (`ESC[` at the end of one read, `>1u` at the
/// start of the next). The tail that might be the start of one is carried over.
public struct KittyFilterState: Equatable {
    public var carry: [UInt8] = []
    public init() {}
}

private let csiLeads: Set<UInt8> = [0x3f, 0x3e, 0x3c, 0x3d]   // ? > < =

public func stripKittyNegotiation(_ bytes: [UInt8], state: inout KittyFilterState) -> [UInt8] {
    let input = state.carry + bytes
    state.carry = []
    var out: [UInt8] = []
    out.reserveCapacity(input.count)
    var i = 0
    while i < input.count {
        guard input[i] == 0x1b else { out.append(input[i]); i += 1; continue }
        // Possible start of a negotiation: ESC [ lead digits/; u
        var j = i + 1
        if j == input.count { state.carry = [0x1b]; return out }
        guard input[j] == 0x5b else { out.append(input[i]); i += 1; continue }
        j += 1
        if j == input.count { state.carry = Array(input[i...]); return out }
        guard csiLeads.contains(input[j]) else { out.append(input[i]); i += 1; continue }
        j += 1
        while j < input.count, (input[j] >= 0x30 && input[j] <= 0x39) || input[j] == 0x3b { j += 1 }
        if j == input.count { state.carry = Array(input[i...]); return out }
        if input[j] == 0x75 { i = j + 1; continue }   // a kitty sequence: dropped
        out.append(input[i]); i += 1                   // some other private CSI: kept
    }
    return out
}
