import Foundation
import FigmaClaudeCore

/// The key log's two pure parts: a readable line per chunk, and the kitty negotiations in a chunk.
enum KeyLogTests {
    static func run() {
        lines()
        negotiations()
    }

    static func lines() {
        Checks.expect(hexLine([0x03]), "03  \"^C\"")
        Checks.expect(hexLine([0x1b, 0x5b, 0x39, 0x39, 0x3b, 0x35, 0x75]), "1b 5b 39 39 3b 35 75  \"ESC[99;5u\"")
        Checks.expect(hexLine([0x1b, 0x7f]), "1b 7f  \"ESCDEL\"")
        Checks.expect(hexLine([0x09, 0x0d]), "09 0d  \"TABCR\"")
        Checks.expect(hexLine(Array("c".utf8)), "63  \"c\"")
    }

    static func negotiations() {
        let query: [UInt8] = [0x1b, 0x5b, 0x3f, 0x75]
        let push: [UInt8] = Array("\u{1b}[>1u".utf8)
        let set: [UInt8] = Array("\u{1b}[=1;1u".utf8)
        let pop: [UInt8] = Array("\u{1b}[<u".utf8)
        let colour: [UInt8] = Array("\u{1b}[38;5;2m".utf8)
        Checks.expect(kittyNegotiations(in: Array("hello".utf8) + query + colour + push), ["ESC[?u", "ESC[>1u"])
        Checks.expect(kittyNegotiations(in: set + pop), ["ESC[=1;1u", "ESC[<u"])
        Checks.expect(kittyNegotiations(in: colour + Array("\u{1b}[?25l".utf8)), [])
        Checks.expect(kittyNegotiations(in: []), [])
    }
}
