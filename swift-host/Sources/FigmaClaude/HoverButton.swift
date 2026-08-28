import AppKit
import FigmaClaudeCore

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

/// The panel's connection light, as a symbol rather than a drawn circle.
///
/// Filled means the thing is up, empty means it is not — so the state survives a screen where
/// green and red do not separate, and the same two glyphs read the same in the toolbar button and
/// in the menu above it.
func statusDot(_ colour: NSColor, filled: Bool, pointSize: CGFloat = 8) -> NSImage? {
    guard let image = NSImage(systemSymbolName: filled ? "circle.fill" : "circle",
                              accessibilityDescription: filled ? "connected" : "not connected")
    else { return nil }
    let configuration = NSImage.SymbolConfiguration(pointSize: pointSize, weight: .regular)
        .applying(NSImage.SymbolConfiguration(paletteColors: [colour]))
    return image.withSymbolConfiguration(configuration)
}

/// The light for one status row. `warn` is the state between the two: the daemon answers but
/// Figma does not, or the port is unused because Safe Mode goes through the plugin — running, so
/// filled, but not green. Shared by the toolbar button and the menu, so the two cannot disagree.
func statusIcon(_ state: StatusRow.State) -> NSImage? {
    switch state {
    case .ok: return statusDot(.systemGreen, filled: true)
    case .warn: return statusDot(.systemOrange, filled: true)
    case .off: return statusDot(.systemRed, filled: false)
    }
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

    private var iconViews: [NSImageView] = []
    private var labelWidth: NSLayoutConstraint?
    private var iconView: NSImageView { iconViews[0] }
    private let label = TightLabel(labelWithString: "")
    private let stack = NSStackView()

    convenience init(symbol: String, spacing: CGFloat = 5, padding: CGFloat = 8) {
        self.init(icons: [symbolImage([symbol]).image], spacing: spacing, padding: padding)
    }

    /// Several icons on purpose: the Figma button carries one light per connection — the daemon
    /// and Figma itself — the way the Electron toolbar does, and they have to sit inside the
    /// button's field rather than beside it, or the hover surface stops where the state begins.
    init(icons: [NSImage?], spacing: CGFloat = 5, padding: CGFloat = 8) {
        super.init(frame: .zero)
        title = ""
        image = nil
        isBordered = false

        for icon in icons {
            let view = NSImageView()
            view.image = icon
            view.contentTintColor = .labelColor
            view.imageScaling = .scaleNone
            // Sized to the glyph, not to whatever an image view would like to be: an image view
            // 19 points wide around a 15-point folder put 4 points of nothing next to the icon.
            if let icon {
                view.widthAnchor.constraint(equalToConstant: icon.size.width).isActive = true
                view.heightAnchor.constraint(equalToConstant: icon.size.height).isActive = true
            }
            iconViews.append(view)
        }
        label.font = .systemFont(ofSize: 11)
        label.textColor = .labelColor
        // Shorten rather than squeeze: without the single-line mode and the cell flag, AppKit
        // looks for a line break first and compresses the glyphs when it finds none.
        label.lineBreakMode = .byTruncatingTail
        label.usesSingleLineMode = true
        label.cell?.truncatesLastVisibleLine = true
        label.setContentCompressionResistancePriority(.init(1), for: .horizontal)

        stack.orientation = .horizontal
        stack.spacing = spacing
        stack.alignment = .centerY
        stack.edgeInsets = NSEdgeInsets(top: 4, left: padding, bottom: 4, right: padding)
        // The lights sit closer to each other than to the label: they are one readout, not two
        // items in a row.
        let lights = NSStackView(views: iconViews)
        lights.orientation = .horizontal
        lights.spacing = 3
        lights.alignment = .centerY
        stack.addArrangedSubview(lights)
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

    /// How wide the button is with no label at all — symbols and padding. It never goes below this.
    var minimumWidth: CGFloat {
        let icons = iconViews.reduce(0) { $0 + ($1.image?.size.width ?? 0) }
        let between = CGFloat(max(0, iconViews.count - 1)) * 3
        return icons + between + stack.edgeInsets.left + stack.edgeInsets.right
    }

    /// What the label needs to draw its text whole.
    ///
    /// Measured on a copy, not on the label itself, so the answer does not change with whatever
    /// budget it was given a moment ago. Rounded up with a point to spare: pinned to exactly its
    /// fractional width, AppKit still shortens the last glyph — that was the ellipsis showing up
    /// at widths that had room for everything. The slack belongs in the wanted width so the row's
    /// arithmetic knows about it, rather than being added later behind its back.
    var labelWanted: CGFloat {
        // The label itself, not a copy of it. A plain `NSTextField` with the same string and font
        // measured 47 points where this one needs 51 — single-line mode and the truncating cell
        // each add padding — and budgeting the smaller number is what put an ellipsis into a bar
        // with room to spare. `intrinsicContentSize` is content-based, so the width constraint
        // already on the label does not colour the answer.
        label.intrinsicContentSize.width.rounded(.up) + 1
    }

    /// The gap the label costs on top of its own width, once it is shown at all.
    var labelGap: CGFloat { stack.spacing }

    /// Is the label still on show? Read by the row's measurement.
    var hasLabel: Bool { !label.isHidden }

    /// Hands the label its share of the row. Zero drops it — an ellipsis with one letter in front
    /// says less than the symbol it crowds.
    func setLabelBudget(_ width: CGFloat) {
        let hidden = width <= 0
        if label.isHidden != hidden { label.isHidden = hidden }

        // The label gives way before anything else in the row (resistance 1), so its width has to
        // be stated even when there is room to spare — dropping the constraint let the stack
        // squeeze it to nothing. And where the budget covers the whole text it is rounded *up*
        // with a point to spare: pinned to exactly its own fractional width, AppKit still shortened
        // the last glyph, which is the ellipsis that turned up at widths that had room for
        // everything.
        if hidden {
            labelWidth?.isActive = false
        } else {
            // Stated even when there is room to spare: the label gives way before anything else in
            // the row (resistance 1), and without a width the stack squeezes it to nothing.
            let constant = min(width.rounded(.down), labelWanted)
            if labelWidth == nil {
                labelWidth = label.widthAnchor.constraint(equalToConstant: constant)
            }
            labelWidth?.constant = constant
            labelWidth?.isActive = true
        }
        invalidateIntrinsicContentSize()
    }

    /// The button has no cell content of its own, so its size comes from the stack.
    override var intrinsicContentSize: NSSize {
        let fitting = stack.fittingSize
        return NSSize(width: fitting.width, height: max(fitting.height, 26))
    }

    /// New lights, same views — a fresh image view per poll would relayout the whole row.
    func setIcons(_ images: [NSImage?]) {
        for (view, image) in zip(iconViews, images) { view.image = image }
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
