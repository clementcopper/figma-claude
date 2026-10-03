import Foundation

/// The Edit menu as data — so the window builds it and `CoreChecks` can read it.
///
/// The app built App, Tabs and View menus and nothing else, and the comment above `buildMenu`
/// said the menu was what gave ⌘-chords somewhere to go. True for ⌘Q, ⌘T and ⌘W only: without an
/// Edit menu an AppKit app has no key equivalent for `copy:`, `paste:` or `selectAll:`, so ⌘C,
/// ⌘V and ⌘A fell through SwiftTerm's `keyDown` into `interpretKeyEvents` and ended at `noop:`.
/// Nothing could be copied out of the terminal and nothing pasted into the prompt (Daniel,
/// 2026-10-03). SwiftTerm implements `copy(_:)`, `paste(_:)` and `selectAll(_:)` and validates
/// them (`copy` only with a selection); the menu is the missing wiring, not the responders.
public struct EditMenuEntry: Equatable {
    public let title: String
    /// The Objective-C selector name the item sends up the responder chain (`target` nil).
    public let selector: String
    public let key: String
    public let separatorBefore: Bool

    public init(title: String, selector: String, key: String, separatorBefore: Bool = false) {
        self.title = title
        self.selector = selector
        self.key = key
        self.separatorBefore = separatorBefore
    }
}

public let editMenuEntries: [EditMenuEntry] = [
    // No Cut: a terminal has nothing to cut, and SwiftTerm has no `cut:` — the item was dead
    // from the start (`--print-mainmenu` showed it DISABLED).
    EditMenuEntry(title: "Copy", selector: "copy:", key: "c"),
    EditMenuEntry(title: "Paste", selector: "paste:", key: "v"),
    EditMenuEntry(title: "Select All", selector: "selectAll:", key: "a", separatorBefore: true),
    // ⌘⌫: SwiftTerm sends nothing for it (no `.command` branch; AppKit's
    // `deleteToBeginningOfLine:` ends at "Unhandle selector"). Terminal.app and iTerm2 turn it
    // into ⌃U, which Claude Code reads as "delete to line start" — so does the host.
    EditMenuEntry(title: "Delete to Line Start", selector: "deleteToLineStart:", key: "\u{08}", separatorBefore: true),
]

/// What ⌘V does with the clipboard. SwiftTerm's own `paste(_:)` reads the string only, so an
/// image became `""`. Claude Code reads an image from the clipboard itself when it receives
/// Ctrl+V (0x16); with an image and no text, ⌘V sends exactly that byte instead. Text wins when
/// both are present — that is what a terminal paste means.
public enum PasteRoute: Equatable {
    case text
    case imageKey
    case nothing
}

public func pasteRoute(hasString: Bool, hasImage: Bool) -> PasteRoute {
    if hasString { return .text }
    return hasImage ? .imageKey : .nothing
}

/// The byte Ctrl+V sends — what Claude Code listens for before it looks at the clipboard.
public let controlVByte: UInt8 = 0x16

/// The byte Ctrl+U sends — Claude Code's "delete from cursor to line start"; ⌘⌫ maps to it.
public let controlUByte: UInt8 = 0x15
