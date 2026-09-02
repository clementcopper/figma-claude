import AppKit
import FigmaClaudeCore

/// One ring with its two-line label beside it — the unit that wraps.
///
/// It hugs its label, which is why the wrap steps cannot be pixel constants anywhere: "Week /
/// Sun 1:00 AM" is the widest group in the default state, and a longer reset time moves every
/// step after it.
final class StatusRingGroup: NSView {
    private let ring = StatusRingView(frame: .zero)
    private let nameLabel = NSTextField(labelWithString: "")
    private let subLabel = NSTextField(labelWithString: "")

    init(name: String) {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false

        nameLabel.stringValue = name
        // Name and value share one colour on purpose: they are two halves of one reading, not a
        // label and its data.
        for (label, weight) in [(nameLabel, NSFont.Weight.semibold), (subLabel, .regular)] {
            label.font = StatusPalette.font(size: 9, weight: weight)
            label.textColor = StatusPalette.text
            label.translatesAutoresizingMaskIntoConstraints = false
        }

        let text = NSStackView(views: [nameLabel, subLabel])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 0
        text.translatesAutoresizingMaskIntoConstraints = false

        let row = NSStackView(views: [ring, text])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 3
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)

        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.topAnchor.constraint(equalTo: topAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func set(mode: StatusRingView.Mode, level: StatusLevel, value: String, sub: String) {
        ring.set(mode: mode, level: level, value: value)
        subLabel.stringValue = sub
        subLabel.isHidden = sub.isEmpty
    }
}

/// The stop button: a disc that turns red under the pointer.
///
/// An own surface rather than a bare glyph — at this type size a lone icon disappears into the
/// row. On hover it takes the same red the rings turn at their threshold, so the row carries one
/// danger colour rather than two, and the glyph goes white on it.
final class StatusStopButton: NSView {
    var onClick: (() -> Void)?

    private let glyph = NSView()
    private var hovering = false { didSet { applyState() } }
    private var pressed = false { didSet { applyState() } }
    private var tracking: NSTrackingArea?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        translatesAutoresizingMaskIntoConstraints = false
        wantsLayer = true
        layer?.cornerRadius = RingGeometry.boxSize / 2

        glyph.wantsLayer = true
        glyph.layer?.cornerRadius = 1.5
        glyph.translatesAutoresizingMaskIntoConstraints = false
        addSubview(glyph)

        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: RingGeometry.boxSize),
            heightAnchor.constraint(equalToConstant: RingGeometry.boxSize),
            glyph.widthAnchor.constraint(equalToConstant: 11),
            glyph.heightAnchor.constraint(equalToConstant: 11),
            glyph.centerXAnchor.constraint(equalTo: centerXAnchor),
            glyph.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])

        toolTip = "Stop the current turn"
        setAccessibilityRole(.button)
        setAccessibilityLabel("Stop the current turn")
        applyState()
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    /// Forces the hover look for the render probe — a still image has no pointer, and this state
    /// is exactly the one that would otherwise never be checked.
    func previewHover() { hovering = true }

    private func applyState() {
        let active = hovering || pressed
        layer?.backgroundColor = (active ? StatusPalette.danger : StatusPalette.disc).cgColor
        glyph.layer?.backgroundColor = (active ? NSColor.white : StatusPalette.text).cgColor
        layer?.opacity = pressed ? 0.85 : 1
    }

    override func updateLayer() { applyState() }

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
    override func mouseDown(with event: NSEvent) { pressed = true }

    override func mouseUp(with event: NSEvent) {
        let inside = bounds.contains(convert(event.locationInWindow, from: nil))
        pressed = false
        // Only a release inside counts, the way every other button on the platform behaves —
        // dragging off a button is how you change your mind about pressing it.
        if inside { onClick?() }
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .pointingHand)
    }
}

/// Stop disc plus the model and its effort chip — the one pair that never splits across lines.
///
/// It was two flat siblings for a while, which let a narrow panel leave the stop button alone on
/// a line with the model below it. Grouping only these two keeps that from happening while the
/// four ring groups still wrap individually, which is the behaviour the separation bought.
final class StatusHeadGroup: NSView {
    let stop = StatusStopButton(frame: .zero)
    private let modelLabel = NSTextField(labelWithString: "")
    private let effortLabel = NSTextField(labelWithString: "")
    private let effortBox = NSView()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        translatesAutoresizingMaskIntoConstraints = false

        // 36pt, the same box as a ring — measured, not guessed. At 18 the head came out 16pt
        // narrower than the design and the 220pt panel stopped wrapping to three lines.

        modelLabel.font = StatusPalette.font(size: 10, weight: .semibold)
        modelLabel.textColor = StatusPalette.text
        effortLabel.font = StatusPalette.font(size: 8, weight: .medium)
        effortLabel.textColor = StatusPalette.subtleText

        effortBox.wantsLayer = true
        effortBox.layer?.backgroundColor = StatusPalette.disc.cgColor
        effortBox.layer?.cornerRadius = 3
        effortBox.translatesAutoresizingMaskIntoConstraints = false
        effortLabel.translatesAutoresizingMaskIntoConstraints = false
        effortBox.addSubview(effortLabel)
        NSLayoutConstraint.activate([
            effortLabel.leadingAnchor.constraint(equalTo: effortBox.leadingAnchor, constant: 4),
            effortLabel.trailingAnchor.constraint(equalTo: effortBox.trailingAnchor, constant: -4),
            effortLabel.topAnchor.constraint(equalTo: effortBox.topAnchor, constant: 1),
            effortLabel.bottomAnchor.constraint(equalTo: effortBox.bottomAnchor, constant: -1)
        ])

        // Both lines start on the same left edge. Centred, the model name and the chip are
        // different lengths, so each line began somewhere else and the pair wandered against the
        // disc beside it. This is the second turn at this spot; left is the state in the file.
        let text = NSStackView(views: [modelLabel, effortBox])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 3
        text.translatesAutoresizingMaskIntoConstraints = false

        let row = NSStackView(views: [stop, text])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 5
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)

        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            // The head carries its own separation from the first ring: 8pt now, down from 12.
            row.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            row.topAnchor.constraint(equalTo: topAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func set(model: String, effort: String?) {
        modelLabel.stringValue = model
        effortBox.isHidden = (effort ?? "").isEmpty
        effortLabel.stringValue = (effort ?? "").uppercased()
    }
}

/// The main row: head plus four ring groups, wrapping like `flex-wrap` and centring itself once
/// everything fits on one line.
///
/// AppKit has no wrapping stack, so the decision lives in `StatusFlow` (pure, and tested against
/// the five panel widths Daniel measured) and this view only places what it is told. Widths come
/// from `fittingSize` rather than from constants: the ring groups hug their labels, so a longer
/// reset time than "Sun 1:00 AM" moves every step.
final class StatusRingRow: NSView {
    /// Between two items on a line, and between two lines. Both were 12 and are now 8.
    static let columnGap: CGFloat = 8
    static let rowGap: CGFloat = 8
    /// The row's own left and right padding, which the wrap has to be told about.
    static let horizontalPadding: CGFloat = 8

    static var debugFrames = false
    private var items: [NSView] = []

    func setItems(_ views: [NSView]) {
        for view in items { view.removeFromSuperview() }
        items = views
        for view in views {
            // This row places its children by hand, so each one has to own its frame again.
            // The groups switch it off for their own internal constraints, and leaving it off
            // here let Auto Layout put every item at the same origin: the numbers still reported
            // one row of the right height while the image showed only the last group, drawn over
            // the other four. Their internal constraints are unaffected.
            view.translatesAutoresizingMaskIntoConstraints = true
            addSubview(view)
        }
        invalidateIntrinsicContentSize()
        needsLayout = true
    }

    /// Each item's natural width, measured rather than assumed.
    private var itemWidths: [CGFloat] {
        items.map { $0.fittingSize.width }
    }

    private var rows: [[Int]] {
        StatusFlow.wrap(widths: itemWidths,
                        available: bounds.width - StatusRingBar.horizontalPaddingTotal,
                        columnGap: StatusRingRow.columnGap)
    }

    /// A wrapping view's height depends on the width it is given, and Auto Layout asks for the
    /// height first — at that point the view is still zero wide, every item lands on its own line
    /// and the answer is the tallest possible one. Measured: 212pt at all five widths, which is
    /// exactly five stacked rows. The width has to invalidate the height when it changes.
    private var measuredAtWidth: CGFloat = -1

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        if abs(newSize.width - measuredAtWidth) > 0.5 {
            measuredAtWidth = newSize.width
            invalidateIntrinsicContentSize()
            onHeightChange?()
        }
    }

    /// The owning view has its own intrinsic height built on this one, and Auto Layout does not
    /// propagate that on its own.
    var onHeightChange: (() -> Void)?

    override var intrinsicContentSize: NSSize {
        let laidOut = rows
        guard !laidOut.isEmpty else { return NSSize(width: NSView.noIntrinsicMetric, height: 0) }
        let tallest = items.map { $0.fittingSize.height }.max() ?? RingGeometry.boxSize
        let height = CGFloat(laidOut.count) * tallest
            + CGFloat(laidOut.count - 1) * StatusRingRow.rowGap
        return NSSize(width: NSView.noIntrinsicMetric, height: height)
    }

    override func layout() {
        super.layout()
        let laidOut = rows
        guard !laidOut.isEmpty else { return }

        let available = bounds.width - StatusRingBar.horizontalPaddingTotal
        let tallest = items.map { $0.fittingSize.height }.max() ?? RingGeometry.boxSize
        // Centred only while the whole block fits on one line — that is the 500pt case in the
        // frame, where the leftover splits evenly and the margins measure 51pt each. Wrapped, the
        // rows keep the left edge so the head stays in line with the file and directory rows.
        let centred = laidOut.count == 1

        var y = bounds.maxY - tallest
        for row in laidOut {
            let widths = row.map { items[$0].fittingSize.width }
            let lineWidth = StatusFlow.lineWidth(widths: widths, columnGap: StatusRingRow.columnGap)
            var x = StatusRingRow.horizontalPadding
            if centred { x = (bounds.width - lineWidth) / 2 }

            for index in row {
                let size = items[index].fittingSize
                if StatusRingRow.debugFrames {
                    print(String(format: "  [row] item %d  x %.0f  y %.0f  %.0f×%.0f",
                                 index, x, y + (tallest - size.height) / 2, size.width, size.height))
                }
                items[index].frame = NSRect(x: x, y: y + (tallest - size.height) / 2,
                                            width: size.width, height: size.height)
                x += size.width + StatusRingRow.columnGap
            }
            y -= tallest + StatusRingRow.rowGap
        }
    }
}

enum StatusRingBar {
    static var horizontalPaddingTotal: CGFloat { StatusRingRow.horizontalPadding * 2 }
}
