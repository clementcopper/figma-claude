import AppKit
import FigmaClaudeCore

/// One status line in the Figma menu: a light, a label, a value — and nothing that can be pressed.
///
/// A plain `NSMenuItem` has only two states, and neither fits. Disabled greys the text *and* washes
/// out the light, which is the one thing worth reading. Enabled paints a highlight under the
/// pointer and swallows a click, which promises an action that does not exist. A view-based item
/// has neither: AppKit hands the row to this view, the view draws it, and no mouse tracking or
/// highlighting happens because nothing asks for any.
final class MenuStatusRowView: NSView {
    /// Where the light sits — the column AppKit reserves for a checkmark, so the marks in this
    /// menu all stand in one line and the labels start where every other item's title does.
    private static let markerCenter: CGFloat = 13
    private static let textLeading: CGFloat = 24
    private static let trailingPadding: CGFloat = 14
    private static let rowHeight: CGFloat = 20

    private let icon = NSImageView()
    private let label = NSTextField(labelWithString: "")

    init(_ row: StatusRow) {
        super.init(frame: .zero)

        icon.image = statusIcon(row.state)
        icon.imageScaling = .scaleNone
        icon.translatesAutoresizingMaskIntoConstraints = false

        // The menu's own font, so the row is a line of this menu rather than a label dropped into
        // it; full-strength ink, because these three are the readout and not a disabled control.
        label.font = .menuFont(ofSize: 0)
        label.textColor = .labelColor
        label.stringValue = "\(row.label): \(row.value)"
        label.translatesAutoresizingMaskIntoConstraints = false

        addSubview(icon)
        addSubview(label)
        NSLayoutConstraint.activate([
            icon.centerXAnchor.constraint(equalTo: leadingAnchor, constant: Self.markerCenter),
            icon.centerYAnchor.constraint(equalTo: centerYAnchor),
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Self.textLeading),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
            trailingAnchor.constraint(greaterThanOrEqualTo: label.trailingAnchor,
                                      constant: Self.trailingPadding),
            heightAnchor.constraint(equalToConstant: Self.rowHeight)
        ])
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    /// A menu is as wide as its widest item, and a view item only counts if it says how wide it is.
    override var intrinsicContentSize: NSSize {
        NSSize(width: Self.textLeading + label.intrinsicContentSize.width + Self.trailingPadding,
               height: Self.rowHeight)
    }

    /// Where the light and the text actually sit, so the alignment claim is a number.
    func measure() -> String {
        layoutSubtreeIfNeeded()
        return String(format: "icon %.1f…%.1f | text %.1f…%.1f | height %.1f",
                      icon.frame.minX, icon.frame.maxX,
                      label.frame.minX, label.frame.maxX, bounds.height)
    }
}
