import AppKit

/// A toolbar button with a real surface under the pointer.
///
/// `NSButton` with `isBordered = false` draws nothing at all until it is clicked, so a row of
/// icons gives no sign that any of them can be pressed. This adds the thing that was missing:
/// a rounded field on hover, stronger while held.
class HoverButton: NSButton {
    /// Padding, carried in the button's own size rather than by drawing the hover field larger
    /// than the button. Drawn outwards, the field of a text button reached into the gap beside
    /// it: 8 points of spacing became 1 point between two highlights.
    var horizontalPadding: CGFloat = 0 {
        didSet {
            if horizontalPadding > 0, !(cell is PaddedCell) {
                let padded = PaddedCell()
                padded.title = title
                padded.image = image
                padded.imagePosition = imagePosition
                padded.font = font
                padded.isBordered = false
                padded.target = target
                padded.action = action
                padded.lineBreakMode = lineBreakMode
                cell = padded
            }
            (cell as? PaddedCell)?.padding = horizontalPadding
            invalidateIntrinsicContentSize()
        }
    }
    var minimumHeight: CGFloat = 0 { didSet { invalidateIntrinsicContentSize() } }

    /// `NSButtonCell` lays an image out flush against the leading edge and ignores any extra
    /// width there — measured on the cwd button: bounds 84 wide, image at 0…19, title 19…84. So
    /// the padding has to be put back into the cell's own geometry rather than into the size.
    private final class PaddedCell: NSButtonCell {
        var padding: CGFloat = 0

        override func imageRect(forBounds rect: NSRect) -> NSRect {
            super.imageRect(forBounds: rect).offsetBy(dx: padding, dy: 0)
        }

        override func titleRect(forBounds rect: NSRect) -> NSRect {
            super.titleRect(forBounds: rect).offsetBy(dx: padding, dy: 0)
        }
    }

    override var intrinsicContentSize: NSSize {
        var size = super.intrinsicContentSize
        size.width += horizontalPadding * 2
        size.height = max(size.height, minimumHeight)
        return size
    }

    private var hovering = false { didSet { needsDisplay = true } }
    /// Forces the hover field on for the render probe — a still image has no pointer, and the
    /// padding is exactly what could not be checked otherwise.
    var previewHover = false { didSet { needsDisplay = true } }
    private var pressed = false { didSet { needsDisplay = true } }
    private var tracking: NSTrackingArea?

    /// `NSButton` reports an alignment inset, and a width constraint applies to the alignment
    /// rect rather than the frame — two icons constrained to the same width came out 18.0 and
    /// 18.5 points wide depending on the symbol, which put one gap in the row on a half point.
    override var alignmentRectInsets: NSEdgeInsets { NSEdgeInsets() }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds,
                                  options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
                                  owner: self)
        addTrackingArea(area)
        tracking = area
    }

    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false; pressed = false }

    override func mouseDown(with event: NSEvent) {
        pressed = true
        super.mouseDown(with: event)
        pressed = false
    }

    /// The title has to be re-measured when it changes, or the padding is computed for the
    /// previous folder name.
    override var title: String {
        didSet { invalidateIntrinsicContentSize() }
    }

    override func draw(_ dirtyRect: NSRect) {
        if isEnabled, hovering || pressed || previewHover {
            let field = bounds
            NSColor.controlAccentColor.withAlphaComponent(pressed ? 0.28 : 0.12).setFill()
            NSBezierPath(roundedRect: field, xRadius: 4, yRadius: 4).fill()
        }
        super.draw(dirtyRect)
    }
}

/// The symbol a system actually has.
///
/// `NSImage(systemSymbolName:)` returns nil for a symbol the running macOS does not know — no
/// icon at all, not a similar one. Two of the symbols this panel asks for arrived with SF
/// Symbols 6 (macOS 15) and are absent on 13, so every name comes with a fallback and the first
/// one that resolves wins. After a system update the preferred one appears by itself.
func symbolImage(_ names: [String], pointSize: CGFloat = 13,
                 weight: NSFont.Weight = .regular,
                 describing: String? = nil) -> (image: NSImage?, used: String?) {
    let configuration = NSImage.SymbolConfiguration(pointSize: pointSize, weight: weight)
    for name in names {
        if let image = NSImage(systemSymbolName: name, accessibilityDescription: describing) {
            return (image.withSymbolConfiguration(configuration), name)
        }
    }
    return (nil, nil)
}

/// A button that lays out its own icon and label.
///
/// `NSButtonCell` was fought twice over this. It puts an image flush against the leading edge and
/// ignores extra width there — measured `image 0.0…19.0` in a button 84 wide — and its
/// image-to-title spacing is not settable. Shifting the cell's rects fixed the leading edge but
/// left the gap to the label too wide and the trailing padding uneven, because the title rect
/// runs past the bounds (`title 26.0…91.0` in those same 84 points).
///
/// Two subviews in a stack settle all three: the spacing is a number, and the padding is the
/// stack's own inset on both sides.
final class IconLabelButton: HoverButton {
    /// `NSTextField` reports an alignment inset, and `NSStackView` spaces by alignment rects —
    /// so a spacing of 5 came out as 3 between the frames and wider still between the glyphs,
    /// while the trailing padding lost the same 2 points. Zeroing it makes one number mean one
    /// thing.
    private final class TightLabel: NSTextField {
        override var alignmentRectInsets: NSEdgeInsets { NSEdgeInsets() }
    }

    private let iconView = NSImageView()
    private let label = TightLabel(labelWithString: "")
    private let stack = NSStackView()

    init(symbol: String, spacing: CGFloat = 5, padding: CGFloat = 8) {
        super.init(frame: .zero)
        title = ""
        image = nil
        isBordered = false

        let icon = symbolImage([symbol]).image
        iconView.image = icon
        iconView.contentTintColor = .labelColor
        iconView.imageScaling = .scaleNone
        // Sized to the glyph, not to whatever an image view would like to be: an image view 19
        // points wide around a 15-point folder put 4 points of nothing next to the icon.
        if let icon {
            iconView.widthAnchor.constraint(equalToConstant: icon.size.width).isActive = true
            iconView.heightAnchor.constraint(equalToConstant: icon.size.height).isActive = true
        }
        label.font = .systemFont(ofSize: 11)
        label.textColor = .labelColor
        label.lineBreakMode = .byTruncatingTail

        stack.orientation = .horizontal
        stack.spacing = spacing
        stack.alignment = .centerY
        stack.edgeInsets = NSEdgeInsets(top: 4, left: padding, bottom: 4, right: padding)
        stack.addArrangedSubview(iconView)
        stack.addArrangedSubview(label)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    /// The button has no cell content of its own, so its size comes from the stack.
    override var intrinsicContentSize: NSSize {
        let fitting = stack.fittingSize
        return NSSize(width: fitting.width, height: max(fitting.height, 26))
    }

    var text: String {
        get { label.stringValue }
        set {
            label.stringValue = newValue
            invalidateIntrinsicContentSize()
        }
    }

    /// Where the icon and the label actually sit, so a padding claim is a number.
    func measure() -> String {
        let icon = iconView.convert(iconView.bounds, to: self)
        let text = label.convert(label.bounds, to: self)
        return String(format: "width %.1f | icon %.1f…%.1f | label %.1f…%.1f | gap %.1f | right %.1f",
                      bounds.width, icon.minX, icon.maxX, text.minX, text.maxX,
                      text.minX - icon.maxX, bounds.width - text.maxX)
    }
}
