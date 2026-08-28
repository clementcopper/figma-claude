import AppKit

/// The strip of tabs down the right edge.
///
/// Narrow on purpose: at 546 points of window width a labelled tab list costs a fifth of the
/// terminal, and the name is not what you look at — the number is. `Claude 2` and the working
/// directory live in the tooltip.
///
/// What the Electron host spent 368 lines of DOM and 457 lines of CSS on is this file, because
/// the state it draws already lives in the same process.
final class TabStripView: NSView {
    var onSelect: ((Int) -> Void)?
    var onClose: ((Int) -> Void)?
    var onNewTab: (() -> Void)?

    /// Wider than the numbers need: the number and the close mark sit side by side inside a tab,
    /// and at 44 points the mark started where the digit ended.
    static let stripWidth: CGFloat = 52
    /// One size for a tab and for the button that makes one.
    static let tabWidth: CGFloat = 44
    static let tabHeight: CGFloat = 24

    private let stack = NSStackView()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true

        stack.orientation = .vertical
        stack.spacing = 2
        stack.alignment = .centerX
        stack.edgeInsets = NSEdgeInsets(top: 4, left: 0, bottom: 4, right: 0)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor),
            widthAnchor.constraint(equalToConstant: TabStripView.stripWidth)
        ])
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func updateLayer() {
        layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
    }

    /// Rebuilds the strip. Cheap enough at these counts that diffing would be more code than it
    /// saves, and it keeps "what is drawn" a pure function of the state.
    /// Where the number ends and the close mark begins — a spacing claim is otherwise squinting
    /// at a screenshot.
    func measureTab(at index: Int) -> String {
        guard let item = stack.arrangedSubviews.dropFirst(index).first as? TabItemView else {
            return "no tab"
        }
        return String(format: "width %.0f, gap number→mark %.1f", item.frame.width, item.measuredGap)
    }

    /// Draws one tab as if the pointer were on it, for the render probe.
    func previewHover(at index: Int) {
        (stack.arrangedSubviews.dropFirst(index).first as? TabItemView)?.previewHover = true
    }

    func render(titles: [String], tooltips: [String], activeIndex: Int?, waiting: Set<Int>) {
        for view in stack.arrangedSubviews {
            stack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }

        for (index, title) in titles.enumerated() {
            let item = TabItemView(number: index + 1,
                                   isActive: index == activeIndex,
                                   isWaiting: waiting.contains(index))
            item.toolTip = index < tooltips.count ? tooltips[index] : title
            item.onSelect = { [weak self] in self?.onSelect?(index) }
            item.onClose = { [weak self] in self?.onClose?(index) }
            stack.addArrangedSubview(item)
        }

        // The same button as the three in the toolbar — symbol, hover field, weight — but as
        // wide as a tab, so the column has one edge rather than two.
        let add = HoverButton()
        add.image = symbolImage(["plus"]).image
        add.imagePosition = .imageOnly
        add.isBordered = false
        add.toolTip = "New tab (⌘T)"
        add.target = self
        add.action = #selector(newTabClicked)
        add.widthAnchor.constraint(equalToConstant: TabStripView.tabWidth).isActive = true
        add.heightAnchor.constraint(equalToConstant: TabStripView.tabHeight).isActive = true
        stack.addArrangedSubview(add)
    }

    @objc private func newTabClicked() { onNewTab?() }
}

/// One square in the strip: its number, and a dot when Claude is waiting for an answer.
///
/// Closing appears on hover, the way a Safari tab does it: an `xmark` at the trailing edge with
/// a soft field of its own, not the red strip the Electron panel slides out
/// (`app/media/styles.css:303`) — that is a VS Code habit, not a Mac one.
///
/// Two earlier attempts were wrong. A `×` replacing the number made every click close the tab,
/// so a tab could never be selected at all. A `×` in the corner was a 12-point target nobody
/// hits. The strip is wider now so the mark and the number can sit side by side.
final class TabItemView: NSView {
    var onSelect: (() -> Void)?
    var onClose: (() -> Void)?

    private let isActive: Bool
    private let numberLabel: NSTextField
    private var tracking: NSTrackingArea?
    private var overClose = false { didSet { needsDisplay = true } }
    private var hovering = false { didSet { needsDisplay = true } }
    /// Forces the hover state for the render probe — a still image has no pointer, and the close
    /// mark is exactly what could not be checked otherwise.
    var previewHover = false {
        didSet {
            hovering = previewHover
            needsDisplay = true
        }
    }

    /// Where the close mark sits: 18 points square, which is a target you hit, and far enough
    /// from the digit that the two do not read as one thing.
    private var closeRect: NSRect {
        NSRect(x: bounds.maxX - 21, y: bounds.midY - 9, width: 18, height: 18)
    }

    /// The gap between the number and the mark, measured rather than eyeballed.
    var measuredGap: CGFloat {
        closeRect.minX - numberLabel.frame.maxX
    }

    init(number: Int, isActive: Bool, isWaiting: Bool) {
        self.isActive = isActive
        numberLabel = NSTextField(labelWithString: String(number))
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 4
        translatesAutoresizingMaskIntoConstraints = false

        numberLabel.font = .systemFont(ofSize: 11, weight: isActive ? .semibold : .regular)
        numberLabel.textColor = isActive ? .labelColor : .secondaryLabelColor
        numberLabel.alignment = .center
        numberLabel.translatesAutoresizingMaskIntoConstraints = false
        addSubview(numberLabel)
        // Centred in what is left of the tab once the close mark has its 21 points, not pinned
        // to the leading edge: a label is wider than its digit, and anchoring it left put the
        // mark 2 points from it.
        NSLayoutConstraint.activate([
            numberLabel.centerXAnchor.constraint(equalTo: leadingAnchor, constant: 11.5),
            numberLabel.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])

        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: TabStripView.tabWidth),
            heightAnchor.constraint(equalToConstant: TabStripView.tabHeight)
        ])

        if isWaiting {
            // Left of the number rather than over it: the number stays readable, and the dot is
            // what the eye catches when it sweeps the strip.
            let dot = NSView()
            dot.wantsLayer = true
            dot.layer?.backgroundColor = NSColor.systemOrange.cgColor
            dot.layer?.cornerRadius = 2
            dot.translatesAutoresizingMaskIntoConstraints = false
            addSubview(dot)
            NSLayoutConstraint.activate([
                dot.widthAnchor.constraint(equalToConstant: 4),
                dot.heightAnchor.constraint(equalToConstant: 4),
                dot.centerYAnchor.constraint(equalTo: centerYAnchor),
                dot.trailingAnchor.constraint(equalTo: numberLabel.leadingAnchor, constant: -2)
            ])
        }
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds,
                                  options: [.mouseEnteredAndExited, .mouseMoved,
                                            .activeInKeyWindow, .inVisibleRect],
                                  owner: self)
        addTrackingArea(area)
        tracking = area
    }

    override func mouseEntered(with event: NSEvent) { hovering = true }

    override func mouseExited(with event: NSEvent) {
        hovering = false
        overClose = false
    }

    /// The field only grows once the pointer is actually on it, so the tab has to know where the
    /// pointer is — not just that it is somewhere inside.
    override func mouseMoved(with event: NSEvent) {
        overClose = closeRect.contains(convert(event.locationInWindow, from: nil))
    }

    /// Everything is drawn here, background included. A view that implements `draw(_:)` no
    /// longer gets `updateLayer`, so a background set there silently stops appearing — which is
    /// what happened to the active tab's field the moment the close mark was added.
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        // Background rather than a border: at this size a border is more noise than signal.
        let base: NSColor? = isActive
            ? NSColor.controlAccentColor.withAlphaComponent(0.18)
            : (hovering ? NSColor.controlAccentColor.withAlphaComponent(0.10) : nil)
        if let base {
            base.setFill()
            NSBezierPath(roundedRect: bounds, xRadius: 4, yRadius: 4).fill()
        }

        guard hovering else { return }

        let field = closeRect
        if overClose {
            NSColor.secondaryLabelColor.withAlphaComponent(0.20).setFill()
            NSBezierPath(roundedRect: field, xRadius: 4, yRadius: 4).fill()
        }

        // Two strokes rather than the `xmark` symbol: a template image only tints itself inside
        // a control, and tinting it by hand with `sourceAtop` painted the whole square black.
        let mark = NSBezierPath()
        let inset = field.insetBy(dx: 5.5, dy: 5.5)
        mark.move(to: NSPoint(x: inset.minX, y: inset.minY))
        mark.line(to: NSPoint(x: inset.maxX, y: inset.maxY))
        mark.move(to: NSPoint(x: inset.minX, y: inset.maxY))
        mark.line(to: NSPoint(x: inset.maxX, y: inset.minY))
        mark.lineWidth = 1.3
        mark.lineCapStyle = .round
        (overClose ? NSColor.labelColor : NSColor.secondaryLabelColor).setStroke()
        mark.stroke()
    }

    /// The mark closes, the rest selects.
    override func mouseDown(with event: NSEvent) {
        if closeRect.contains(convert(event.locationInWindow, from: nil)) {
            onClose?()
        } else {
            onSelect?()
        }
    }

    /// Kept alongside the `×`: a right-click is what people reach for on a tab.
    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = NSMenu()
        let item = menu.addItem(withTitle: "Close Tab", action: #selector(closeClicked), keyEquivalent: "")
        item.target = self
        return menu
    }

    @objc private func closeClicked() { onClose?() }
}
