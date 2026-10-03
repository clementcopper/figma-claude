import Foundation
import FigmaClaudeCore

/// The Edit menu as data, and where ⌘V sends the clipboard. No AppKit: the window builds the
/// real `NSMenu` from these entries (`--print-mainmenu` shows the result).
enum EditMenuTests {
    static func run() {
        standardItems()
        pasteRouting()
    }

    /// ⌘C, ⌘V and ⌘A did nothing because no menu item carried the standard selectors.
    static func standardItems() {
        let selectors = editMenuEntries.map(\.selector)
        Checks.expect(selectors, ["copy:", "paste:", "selectAll:", "deleteToLineStart:"])
        // ⌘⌫ is the one chord the host has to map itself: SwiftTerm sends nothing for it, and
        // Terminal.app / iTerm2 turn it into ⌃U (Claude Code's "delete to line start").
        Checks.expect(editMenuEntries.map(\.key), ["c", "v", "a", "\u{08}"])
        Checks.expect(Set(editMenuEntries.map(\.key)).count, editMenuEntries.count)
        Checks.expect(editMenuEntries.allSatisfy { $0.selector.hasSuffix(":") }, true)
        Checks.expect(editMenuEntries.map(\.separatorBefore), [false, false, true, true])
        Checks.expect(controlUByte, 0x15)
    }

    /// An image and no text goes to Claude Code as Ctrl+V; text pastes as text; nothing does nothing.
    static func pasteRouting() {
        Checks.expect(pasteRoute(hasString: true, hasImage: false), .text)
        Checks.expect(pasteRoute(hasString: true, hasImage: true), .text)
        Checks.expect(pasteRoute(hasString: false, hasImage: true), .imageKey)
        Checks.expect(pasteRoute(hasString: false, hasImage: false), .nothing)
        Checks.expect(controlVByte, 0x16)
    }
}
