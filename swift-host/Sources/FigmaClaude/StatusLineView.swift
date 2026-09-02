import AppKit
import FigmaClaudeCore

/// The rows at the bottom edge: what Figma has selected, and what Claude Code reports about
/// itself.
///
/// Three bands, top to bottom:
///
///     Hero                                              ← only while something is selected
///     ──────────────────────────────────────────────────
///     Opus 5  [high]  ▬▬░░░░░░░░░░░░░░░░░░  6%  64,7k / 1M
///     Session 41% · 2h 10m · 15:26      Compacted 3/5  Week 12%
///     …/Designdone/Business
///
/// The view sizes itself from its content: the selection band appears and disappears, and a
/// fixed height would either clip it or leave a gap where it used to be.
final class StatusLineView: NSView {
    var onSelectionClick: (() -> Void)?
    /// The user's clear threshold in percent. Forwarded to the bar and used to pick the fill
    /// colour and the "should clear" toast trigger.
    var contextMarker: Double = 60 {
        didSet { bar.marker = contextMarker; bar.needsDisplay = true }
    }
    /// Called when the dragged marker settles on a new threshold (percent).
    var onMarkerChange: ((Double) -> Void)?

    private let selectionButton = NSButton()
    private let selectionRow = NSStackView()
    private let separator = NSBox()

    private let modelLabel = TightLabel(labelWithString: "")
    private let effortPill = PillView()
    private let bar = BarView()
    /// Diameter of the grab-handle circle, shared by the dot's frame and the tag's offset above
    /// the line. One value, so handle and tooltip always agree (Daniel measures 4px).
    private let markerDiameter: CGFloat = 10
    /// Overlay that renders the marker's grab handle (the circle). It cannot be drawn inside the
    /// bar: a 10-point circle in a 4-point bar, or as its subview, is clipped to those bounds.
    /// Living here as a topmost sibling of the bar, it overhangs the line freely.
    private let markerDot = MarkerDotView()
    /// Overlay that floats the live percent tag above the marker handle. A subview of this view
    /// (not of the bar) and added last, so it sits on top of the stacked rows instead of being
    /// clipped or covered by them. Hidden when there is no hover or drag.
    private let percentTag = TightLabel(labelWithString: "")
    private let percentLabel = TightLabel(labelWithString: "")
    private let tokensLabel = TightLabel(labelWithString: "")
    private let limitLeft = TightLabel(labelWithString: "")
    private let compactedLabel = TightLabel(labelWithString: "")
    private let limitRight = TightLabel(labelWithString: "")
    private let cwdLabel = TightLabel(labelWithString: "")

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        // Let the marker dot and hover tag overhang the view's bounds without being trimmed.
        layer?.masksToBounds = false

        for label in [modelLabel, percentLabel, tokensLabel,
                      limitLeft, compactedLabel, limitRight, cwdLabel] {
            label.font = .systemFont(ofSize: 11)
            label.textColor = .secondaryLabelColor
        }
        modelLabel.font = .systemFont(ofSize: 11, weight: .medium)
        modelLabel.textColor = .labelColor

        // The numbers are the reason anyone looks at this row, so they never give way. Without
        // this the model name wins the fight for width and "38%" renders as "3…".
        // Priorities, not absolutes. `.required` here made the row a floor the window could
        // never go below — measured 318 points, and more with a longer file name, so the window
        // grew to fit its own status bar instead of the other way round. High beats the model
        // name and the path; it still yields to the window.
        modelLabel.lineBreakMode = .byTruncatingTail
        modelLabel.setContentCompressionResistancePriority(.init(400), for: .horizontal)
        modelLabel.setContentHuggingPriority(.required, for: .horizontal)
        for label in [percentLabel, tokensLabel] {
            label.setContentCompressionResistancePriority(.init(800), for: .horizontal)
            label.setContentHuggingPriority(.required, for: .horizontal)
        }
        for label in [limitLeft, compactedLabel, limitRight] {
            label.lineBreakMode = .byTruncatingTail
            label.setContentCompressionResistancePriority(.init(600), for: .horizontal)
            label.setContentHuggingPriority(.required, for: .horizontal)
        }

        // The bar is the only thing in the row with no natural width, so it is the only thing
        // that should absorb what is left over — hence the lowest hugging priority there.
        bar.setContentHuggingPriority(.init(1), for: .horizontal)
        bar.setContentCompressionResistancePriority(.init(1), for: .horizontal)
        bar.onMarkerChange = { [weak self] value in self?.onMarkerChange?(value) }

        cwdLabel.lineBreakMode = .byTruncatingHead
        cwdLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        selectionButton.isBordered = false
        selectionButton.font = .systemFont(ofSize: 11)
        selectionButton.contentTintColor = .linkColor
        selectionButton.target = self
        selectionButton.action = #selector(selectionClicked)

        selectionRow.orientation = .horizontal
        selectionRow.alignment = .centerY
        selectionRow.edgeInsets = NSEdgeInsets(top: 4, left: 4, bottom: 4, right: 8)
        selectionRow.addArrangedSubview(selectionButton)
        selectionRow.addArrangedSubview(spacer())

        separator.boxType = .separator

        let contextRow = NSStackView(views: [modelLabel, effortPill, bar, percentLabel, tokensLabel])
        contextRow.orientation = .horizontal
        contextRow.spacing = 8
        contextRow.alignment = .centerY
        contextRow.distribution = .fill

        let limitRow = NSStackView(views: [limitLeft, spacer(), compactedLabel, limitRight])
        limitRow.orientation = .horizontal
        limitRow.spacing = 8
        limitRow.alignment = .centerY

        let cwdRow = NSStackView(views: [cwdLabel, spacer()])
        cwdRow.orientation = .horizontal
        cwdRow.alignment = .centerY

        let statusRows = NSStackView(views: [contextRow, limitRow, cwdRow])
        statusRows.orientation = .vertical
        statusRows.spacing = 5
        statusRows.alignment = .leading
        statusRows.edgeInsets = NSEdgeInsets(top: 6, left: 8, bottom: 6, right: 8)

        let all = NSStackView(views: [selectionRow, separator, statusRows])
        all.orientation = .vertical
        all.spacing = 0
        all.alignment = .leading
        all.translatesAutoresizingMaskIntoConstraints = false
        addSubview(all)

        // Configure the marker dot (the grab handle circle) and the floating percent tag, both as
        // topmost overlays so neither is clipped to the 4-point bar or a stacked row.
        markerDot.wantsLayer = true
        addSubview(markerDot, positioned: .above, relativeTo: all)

        percentTag.font = .systemFont(ofSize: 10, weight: .medium)
        percentTag.textColor = .labelColor
        percentTag.alignment = .center
        // A filled tag, so the number stays readable over whatever the bar or row shows.
        percentTag.wantsLayer = true
        percentTag.layer?.cornerRadius = 3
        percentTag.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        percentTag.isHidden = true
        percentTag.isEnabled = false
        addSubview(percentTag, positioned: .above, relativeTo: all)

        bar.onMarkerUpdate = { [weak self] centerXInBar, percent, visible, emphasized in
            guard let self else { return }
            self.placeMarkerDot(at: centerXInBar, emphasized: emphasized)
            self.percentTag.stringValue = "\(percent)%"
            let size = self.percentTag.fittingSize
            let tagW = max(size.width + 8, 22)
            let tagH: CGFloat = 15
            let barMid = self.markerDotCenter(at: centerXInBar)
            // This view is not flipped, so y grows upward and the tag sits above the handle with a
            // plus. Above the bar there is only the row's own inset, so the tag overhangs the
            // band's top edge — allowed: `masksToBounds` is off here and the status line is the
            // last band added, so it draws over the terminal the way a tooltip should.
            //
            // Horizontally it is clamped into the view instead: at marker 5% or 95% a centred tag
            // would hang off the window edge, where nothing is drawn over.
            let x = min(max(0, barMid.x - tagW / 2), max(0, self.bounds.width - tagW))
            self.percentTag.frame = NSRect(x: x, y: barMid.y + self.markerDiameter / 2 + 2,
                                           width: tagW, height: tagH)
            self.percentTag.isHidden = !visible
        }

        NSLayoutConstraint.activate([
            all.leadingAnchor.constraint(equalTo: leadingAnchor),
            all.trailingAnchor.constraint(equalTo: trailingAnchor),
            all.topAnchor.constraint(equalTo: topAnchor),
            all.bottomAnchor.constraint(equalTo: bottomAnchor),
            selectionRow.widthAnchor.constraint(equalTo: all.widthAnchor),
            separator.widthAnchor.constraint(equalTo: all.widthAnchor),
            statusRows.widthAnchor.constraint(equalTo: all.widthAnchor),
            contextRow.widthAnchor.constraint(equalTo: statusRows.widthAnchor, constant: -16),
            limitRow.widthAnchor.constraint(equalTo: statusRows.widthAnchor, constant: -16),
            cwdRow.widthAnchor.constraint(equalTo: statusRows.widthAnchor, constant: -16),
            bar.heightAnchor.constraint(equalToConstant: 4),
            // No minimum width on the percentage: a right-aligned label with a floor leaves
            // empty space inside itself at "6%", which reads as a wider gap after the bar than
            // between the numbers. Every gap in this row is now the stack's own 8 points.
            bar.widthAnchor.constraint(greaterThanOrEqualToConstant: 40)
        ])

        renderSelection([])
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    /// An empty view that gives way before anything with content does — what separates a left
    /// group from a right one in a stack that otherwise packs everything to one side.
    private func spacer() -> NSView {
        let view = NSView()
        view.setContentHuggingPriority(.init(1), for: .horizontal)
        view.setContentCompressionResistancePriority(.init(1), for: .horizontal)
        return view
    }

    override func updateLayer() {
        layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
    }

    /// Where the band ends up against what it needs — the number behind "squeezed".
    func measureBands() -> String {
        String(format: "height %.1f | fitting %.1f | selection %@",
               bounds.height, fittingSize.height, selectionRow.isHidden ? "hidden" : "shown")
    }

    /// The band's height comes from `fittingSize`, and that is read in `PanelContentView.layout()`
    /// — which nothing schedules on its own. Without this the row keeps the height it had before
    /// the content changed and the text is squeezed into it: visible the moment a Figma selection
    /// adds its band, and just as true when the limit row appears or goes.
    private func invalidateLayout() {
        needsLayout = true
        superview?.needsLayout = true
    }

    /// A tab Claude has not rendered in yet carries no numbers — the row stays empty rather than
    /// showing a full bar reading `0 / 0`.
    func render(_ snapshot: StatusLineSnapshot?) {
        defer { invalidateLayout() }
        guard let snapshot, !snapshot.isEmpty else {
            for label in [modelLabel, percentLabel, tokensLabel,
                          limitLeft, compactedLabel, limitRight, cwdLabel] {
                label.stringValue = ""
            }
            effortPill.isHidden = true
            bar.isHidden = true
            // The handle belongs to the bar. Without this it kept being drawn against a bar of
            // zero width — a dot at the far left that jumped to the marker the moment Claude Code
            // wrote its first status line and the bar got a width.
            markerDot.isHidden = true
            percentTag.isHidden = true
            return
        }

        bar.isHidden = false
        modelLabel.stringValue = snapshot.model

        if let effort = snapshot.effort, !effort.isEmpty {
            effortPill.isHidden = false
            effortPill.set(text: effort, tint: effortTint(effort))
        } else {
            effortPill.isHidden = true
        }

        // One name for the figure's level, so its colour is always the rate-limit reading.
        let level = contextLevel(snapshot.usedPercent)
        bar.marker = contextMarker
        bar.fraction = min(1, max(0, snapshot.usedPercent / 100))
        // The fill answers a different question — "should I clear?" — against the user's marker.
        bar.color = color(for: contextFillLevel(snapshot.usedPercent, marker: contextMarker))
        percentLabel.stringValue = "\(Int(snapshot.usedPercent.rounded()))%"
        percentLabel.textColor = level == .normal ? .secondaryLabelColor : color(for: level)
        tokensLabel.stringValue = snapshot.totalTokens > 0
            ? "\(formatTokens(snapshot.usedTokens)) / \(formatTokens(snapshot.totalTokens))"
            : ""
        tokensLabel.toolTip = "Context: \(snapshot.usedTokens) of \(snapshot.totalTokens) tokens"

        cwdLabel.stringValue = snapshot.cwd.map { shortenPath($0) } ?? ""
        cwdLabel.toolTip = snapshot.cwd

        if let rows = secondaryRowText(snapshot) {
            limitLeft.stringValue = rows.left
            compactedLabel.stringValue = rows.compacted
            limitRight.stringValue = rows.week
            limitLeft.textColor = snapshot.sessionPercent.map { limitLevel($0) } == .danger
                ? .systemRed : .secondaryLabelColor
            // Never coloured: a compaction count is not a limit being approached.
            compactedLabel.textColor = .secondaryLabelColor
            limitRight.textColor = snapshot.weekPercent.map { limitLevel($0) } == .danger
                ? .systemRed : .secondaryLabelColor
        } else {
            limitLeft.stringValue = ""
            compactedLabel.stringValue = ""
            limitRight.stringValue = ""
        }
    }

    /// The Figma selection gets a band of its own above the separator — and the band disappears
    /// entirely when nothing is selected, rather than leaving an empty line where it was.
    func renderSelection(_ nodes: [SelectedNode]) {
        defer { invalidateLayout() }
        let empty = nodes.isEmpty
        selectionRow.isHidden = empty
        separator.isHidden = empty
        guard !empty else { return }

        selectionButton.title = describeSelection(nodes)
        selectionButton.toolTip = (selectionPromptText(nodes) ?? "") + " — click to add to the prompt"
    }

    /// More effort is a bigger promise about the answer, so the colour climbs with it rather than
    /// being decorative.
    private func effortTint(_ effort: String) -> NSColor {
        if effort.hasPrefix("xhigh") { return .systemPurple }
        if effort.hasPrefix("high") { return .systemIndigo }
        if effort.hasPrefix("medium") { return .systemTeal }
        return .systemGray
    }

    private func color(for level: StatusLevel) -> NSColor {
        switch level {
        case .normal: return .systemBlue
        case .warn: return .systemYellow
        case .danger: return .systemRed
        }
    }

    /// The handle's centre in self's coordinates, from a position given in the bar's coordinates.
    private func markerDotCenter(at xInBar: CGFloat) -> NSPoint {
        bar.convert(NSPoint(x: xInBar, y: bar.bounds.midY), to: self)
    }

    /// Puts the marker circle centrally over the line at the given bar x, in its own colour.
    private func placeMarkerDot(at xInBar: CGFloat, emphasized: Bool) {
        markerDot.emphasized = emphasized
        let c = markerDotCenter(at: xInBar)
        markerDot.frame = NSRect(x: c.x - markerDiameter / 2, y: c.y - markerDiameter / 2,
                                 width: markerDiameter, height: markerDiameter)
    }

    /// The handle is placed here rather than in `layout()`, and this is the only place that does
    /// it outside a drag.
    ///
    /// The bar sits three stacks deep, and a descendant's frame is not final while this view's own
    /// `layout()` runs. Measured: on the pass that resized the band from 100 to 65 points the bar
    /// already reported its new width but still its old origin, so the handle landed 35 points
    /// above the line — exactly the 35 the band had lost. `viewWillDraw` runs after the whole
    /// layout pass and before anything is drawn, so the geometry it reads is final.
    ///
    /// This replaces an async re-check that ran one runloop turn later: it did land on the right
    /// spot, but only after a frame of the wrong one.
    override func viewWillDraw() {
        placeMarker()
        super.viewWillDraw()
    }

    /// Places the handle against the current geometry, for a caller that has to measure or draw
    /// before the next draw pass — the render probe. In the app `viewWillDraw` covers it.
    func placeMarkerNow() {
        placeMarker()
    }

    /// Positions the circle from the bar's current marker, with the emphasis state it should have.
    ///
    /// Also the one place that decides whether the handle exists at all: a hidden bar, or one the
    /// stack has not given a width yet, has no position to put a handle on, and a handle placed
    /// against a zero width lands at the left edge rather than at the marker.
    private func placeMarker() {
        guard !bar.isHidden, bar.bounds.width > 0 else {
            markerDot.isHidden = true
            percentTag.isHidden = true
            return
        }
        markerDot.isHidden = false
        placeMarkerDot(at: bar.markerX, emphasized: bar.hovering || bar.draggingMarker)
    }

    /// Forces the handle's hover/tag state on through the same path a real hover uses, for the
    /// render probe — a still image has no pointer, and the floating percent tag is exactly what
    /// could not be checked otherwise.
    func previewMarkerHandle() {
        bar.previewHandle()
    }

    /// The circle's and tag's geometry in probe space, so the offscreen render can check the handle
    /// is no longer clipped to the 4-point bar and the tag floats over it — numbers, not colours.
    func measureMarkerHandle() -> String {
        let dot = markerDot.convert(markerDot.bounds, to: self)
        let barMinY = bar.convert(NSPoint(x: 0, y: 0), to: self).y
        let barMaxY = bar.convert(NSPoint(x: 0, y: bar.bounds.height), to: self).y
        let dotOverhangsAbove = dot.maxY > barMaxY
        let dotOverhangsBelow = dot.minY < barMinY
        let tag = percentTag.isHidden ? nil : percentTag.convert(percentTag.bounds, to: self)
        guard let tag else { return "tag hidden" }
        let centreX = bar.markerXAcross(self)
        let clip = (dotOverhangsAbove && dotOverhangsBelow) ? "full" : "CLIPPED"
        // Not flipped: above means the tag's *bottom* is at or over the bar's top. The first
        // version of this line compared the other way round and reported "above" for a tag sitting
        // under the bar — the check was part of the bug rather than what caught it.
        let tagOver = tag.minY >= barMaxY ? "above" : "BELOW-BAR"
        // How far the tag reaches past the band's top edge, since it is allowed to and the number
        // is the only way to tell "overhangs by 9" from "is off in the terminal somewhere".
        let over = tag.maxY - bounds.height
        return String(format: "handle@%.0f dot %.0f×%.0f overhang=%@ tag %.0f×%.0f at (%.0f,%.0f) %@ past-top %.0f",
                      centreX, dot.width, dot.height, clip, tag.width, tag.height,
                      tag.minX, tag.minY, tagOver, max(0, over))
    }

    /// The circle's placement on its own — the launch-position check. A still frame's dot must
    /// already sit on the line exactly where the interactive one does; if it does not, the
    /// positioner only ran on interaction, not layout.
    func measureMarkerDot() -> String {
        guard !markerDot.isHidden else { return "dot hidden bar=\(bar.isHidden ? "hidden" : "shown")" }
        let dot = markerDot.convert(markerDot.bounds, to: self)
        let barMid = markerDotCenter(at: bar.bounds.width * CGFloat(bar.marker / 100))
        let barMinY = bar.convert(NSPoint(x: 0, y: 0), to: self).y
        let deltaX = dot.midX - barMid.x
        let deltaY = dot.midY - barMid.y
        return String(format: "dot %@×%@ barMinY=%.0f Δ(cx,cy)=(%.1f,%.1f)",
                      String(format: "%.0f", dot.width), String(format: "%.0f", dot.height),
                      barMinY, deltaX, deltaY)
    }

    /// Every gap in the context row, measured after layout. Judging spacing by eye on a
    /// screenshot is guessing; these are the numbers.
    func measureContextRow() -> String {
        let items: [(String, NSView)] = [("model", modelLabel), ("effort", effortPill),
                                         ("bar", bar), ("percent", percentLabel),
                                         ("tokens", tokensLabel)]
            .filter { !$0.1.isHidden }
        var parts: [String] = []
        for (index, item) in items.enumerated() {
            let frame = item.1.convert(item.1.bounds, to: self)
            parts.append(String(format: "%@ %.0f…%.0f", item.0, frame.minX, frame.maxX))
            if index + 1 < items.count {
                let next = items[index + 1].1
                let gap = next.convert(next.bounds, to: self).minX - frame.maxX
                parts.append(String(format: "[gap %.1f]", gap))
            }
        }
        return parts.joined(separator: " ")
    }

    @objc private func selectionClicked() { onSelectionClick?() }
}

/// A label that takes exactly the space its glyphs need.
///
/// `NSStackView` spaces its children by their *alignment rects*, not their frames, and
/// `NSTextField` reports an inset there. Between two text fields that inset is subtracted twice,
/// so a stack with one spacing produces visibly different gaps depending on what sits either
/// side — measured on the context row: 6, 8, 6 and 4 points for a spacing of 8.
private final class TightLabel: NSTextField {
    override var alignmentRectInsets: NSEdgeInsets { NSEdgeInsets() }
}

/// A small tinted label — `NSTextField` has no padding of its own, so the inset lives here.
private final class PillView: NSView {
    private let label = NSTextField(labelWithString: "")

    init() {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 3
        label.font = .systemFont(ofSize: 10, weight: .semibold)
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 5),
            label.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -5),
            label.topAnchor.constraint(equalTo: topAnchor, constant: 1),
            label.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -1)
        ])
        setContentHuggingPriority(.required, for: .horizontal)
        setContentCompressionResistancePriority(.required, for: .horizontal)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func set(text: String, tint: NSColor) {
        label.stringValue = text
        label.textColor = tint
        layer?.backgroundColor = tint.withAlphaComponent(0.15).cgColor
    }
}

/// A plain filled rectangle rather than `NSProgressIndicator`: that control animates, and here
/// the animation only flickers on every render.
///
/// The user's clear-threshold marker renders as a notched line that overhangs the bar both ways,
/// so it stays visible even when the fill is far below it. Dragging it near the marker moves the
/// threshold; the colour of the fill is chosen by the owner (`contextFillLevel`), so bar and
/// figure text always agree.
private final class BarView: NSView {
    var fraction: Double = 0 { didSet { needsDisplay = true } }
    var color: NSColor = .systemBlue { didSet { needsDisplay = true } }
    /// The clear threshold in percent (0-100). Rendered as the grab handle.
    var marker: Double = 60 {
        didSet {
            needsDisplay = true
            // Keep a live tag following the handle if it is showing.
            if tagVisible { updateMarker(visible: true) }
        }
    }
    /// Called with the new threshold (percent) when the user drags the marker.
    var onMarkerChange: ((Double) -> Void)?
    /// Reports the live percent tag to an owning overlay. The tag cannot live inside this bar:
    /// it overhangs the 4-point bounds, and a subview that sticks out of a stacked, layer-backed
    /// row gets clipped or covered by neighbours. The owner draws it above everything instead.
    var onMarkerUpdate: ((_ centerXInBar: CGFloat, _ percent: Int, _ visible: Bool, _ emphasized: Bool) -> Void)?
    /// Last reported visibility, so a handle move re-sends a showing tag.
    private var tagVisible = false

    /// How close a click must get to the handle, in points, to grab it instead of being a no-op.
    private let grabTolerance: CGFloat = 8
    var draggingMarker = false
    var hovering = false { didSet { needsDisplay = true } }
    private var hasTrackingArea = false

    /// Diameter of the grab handle. It overhangs the 4-point bar so it reads as a thing to grab.
    private let handleDiameter: CGFloat = 10
    fileprivate var markerX: CGFloat { bounds.width * CGFloat(marker / 100) }

    /// The handle's centre x in another view's coordinate space, for the render probe.
    func markerXAcross(_ other: NSView) -> CGFloat {
        convert(NSPoint(x: markerX, y: 0), to: other).x
    }

    /// Forces the hover/tag state on through the real `updateTag` path, for the render probe.
    func previewHandle() {
        hovering = true
        updateMarker(visible: true)
    }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if hasTrackingArea {
            trackingAreas.forEach(removeTrackingArea)
            hasTrackingArea = false
        }
        // `.mouseMoved`, not just enter/exit: `mouseEntered` fires once when the pointer enters the
        // bar's whole rect, so walking in at a point far from the handle never re-fires as you
        // reach it. `mouseMoved` re-evaluates the hover on every movement instead.
        let area = NSTrackingArea(rect: bounds,
                                  options: [.mouseMoved, .mouseEnteredAndExited,
                                            .activeInKeyWindow, .inVisibleRect],
                                  owner: self)
        addTrackingArea(area)
        hasTrackingArea = true
    }

    private func hoveringHandle(at p: NSPoint) -> Bool {
        abs(p.x - markerX) <= grabTolerance + handleDiameter / 2
    }

    override func mouseMoved(with event: NSEvent) {
        // `mouseMoved` only arrives while `.activeInKeyWindow` and the window is key; a poll that
        // steals focus won't leave a stale tag up, but the `isHidden` update keeps it honest.
        let p = convert(event.locationInWindow, from: nil)
        hovering = hoveringHandle(at: p)
        // Keep the tag while dragging even if the pointer drifts, so the number stays readable.
        if !draggingMarker {
            updateMarker(visible: hovering)
        }
    }

    override func mouseEntered(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        hovering = hoveringHandle(at: p)
        updateMarker(visible: hovering)
    }

    override func mouseExited(with event: NSEvent) {
        hovering = false
        if !draggingMarker { updateMarker(visible: false) }
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.separatorColor.setFill()
        NSBezierPath(roundedRect: bounds, xRadius: 2, yRadius: 2).fill()
        if fraction > 0 {
            let filled = NSRect(x: 0, y: 0, width: bounds.width * fraction, height: bounds.height)
            color.setFill()
            NSBezierPath(roundedRect: filled, xRadius: 2, yRadius: 2).fill()
        }
    }

    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        if abs(p.x - markerX) <= grabTolerance {
            draggingMarker = true
            hovering = true
            updateMarker(visible: true)
            needsDisplay = true
        }
    }

    override func mouseDragged(with event: NSEvent) {
        guard draggingMarker else { return }
        let p = convert(event.locationInWindow, from: nil)
        let percent = Double((p.x / bounds.width) * 100)
        marker = min(95, max(5, percent))
        onMarkerChange?(marker)
        updateMarker(visible: true)
    }

    override func mouseUp(with event: NSEvent) {
        if draggingMarker {
            draggingMarker = false
            needsDisplay = true
            // The tag stays up while the pointer still hovers the handle — it only hides once the
            // pointer leaves, or a new hover elsewhere re-positions it.
            let p = convert(event.locationInWindow, from: nil)
            hovering = hoveringHandle(at: p)
            if !hovering { updateMarker(visible: false) }
        }
    }

    /// Reports the handle's position, live percent, tag visibility and emphasis (hover/drag) to
    /// the owner, which draws the circle and tooltip above the bar. The bar only knows where the
    /// handle is; the owner owns the overlays.
    private func updateMarker(visible: Bool) {
        tagVisible = visible
        onMarkerUpdate?(markerX, Int(marker.rounded()), visible, draggingMarker || hovering)
    }
}

/// Draws the marker's grab-handle circle on its own, so it can overhang the 4-point bar without
/// being clipped. The owner positions its frame centrally over the line and toggles `emphasized`
/// with hover or drag.
private final class MarkerDotView: NSView {
    var emphasized = false { didSet { needsDisplay = true } }

    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(ovalIn: bounds)
        NSColor.controlBackgroundColor.setStroke()
        path.lineWidth = 1
        (emphasized ? NSColor.labelColor : NSColor.tertiaryLabelColor).setFill()
        path.fill()
        path.stroke()
    }
}
