import AppKit
import FigmaClaudeCore

/// The status line in its ring form: the main row, and the working directory under it.
///
/// A view of its own rather than a rewrite of `StatusLineView`, so the bar version and the marker
/// work on it stay intact while this one is judged. What each ring shows is decided in
/// `statusRings` (pure, in Core); this only puts the answers on screen.
final class StatusRingLineView: NSView {
    /// The percentage the context ring fills against. Set as a number, not dragged.
    var contextThreshold: Double = defaultContextThreshold {
        didSet { render(lastSnapshot) }
    }
    var onStop: (() -> Void)?
    var onSelectionClick: (() -> Void)?

    // The Figma selection keeps its own band above the rings, exactly as it had above the bar —
    // the ring design replaces the status row, not the panel's other half.
    private let selectionButton = NSButton()
    private let selectionRow = NSStackView()
    private let separator = NSBox()

    private let head = StatusHeadGroup(frame: .zero)
    private let row = StatusRingRow()
    private let cwdLabel = NSTextField(labelWithString: "")
    private var groups: [String: StatusRingGroup] = [:]
    private var lastSnapshot: StatusLineSnapshot?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        translatesAutoresizingMaskIntoConstraints = false

        head.stop.onClick = { [weak self] in self?.onStop?() }

        // Monospaced, like the path it is: a directory read in a proportional face loses the
        // alignment that makes two paths comparable at a glance.
        cwdLabel.font = NSFont.monospacedSystemFont(ofSize: 9, weight: .regular)
        cwdLabel.textColor = StatusPalette.subtleText
        cwdLabel.lineBreakMode = .byTruncatingHead
        cwdLabel.translatesAutoresizingMaskIntoConstraints = false

        selectionButton.isBordered = false
        selectionButton.font = StatusPalette.font(size: 11)
        selectionButton.contentTintColor = .linkColor
        selectionButton.target = self
        selectionButton.action = #selector(selectionClicked)

        selectionRow.orientation = .horizontal
        selectionRow.alignment = .centerY
        selectionRow.edgeInsets = NSEdgeInsets(top: 4, left: 4, bottom: 4, right: 8)
        selectionRow.addArrangedSubview(selectionButton)
        let spacer = NSView()
        spacer.setContentHuggingPriority(.init(1), for: .horizontal)
        selectionRow.addArrangedSubview(spacer)
        selectionRow.isHidden = true

        separator.boxType = .separator
        separator.isHidden = true

        row.onHeightChange = { [weak self] in self?.invalidateIntrinsicContentSize() }

        let stack = NSStackView(views: [selectionRow, separator, row, cwdLabel])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 4
        stack.edgeInsets = NSEdgeInsets(top: 4, left: 0, bottom: 4, right: 0)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
            selectionRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            separator.widthAnchor.constraint(equalTo: stack.widthAnchor),
            row.widthAnchor.constraint(equalTo: stack.widthAnchor),
            cwdLabel.leadingAnchor.constraint(equalTo: stack.leadingAnchor,
                                              constant: StatusRingRow.horizontalPadding),
            cwdLabel.trailingAnchor.constraint(lessThanOrEqualTo: stack.trailingAnchor,
                                               constant: -StatusRingRow.horizontalPadding)
        ])
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func updateLayer() {
        layer?.backgroundColor = StatusPalette.ground.cgColor
    }

    func render(_ snapshot: StatusLineSnapshot?) {
        lastSnapshot = snapshot

        guard let snapshot, !snapshot.isEmpty else {
            defer { invalidateLayout() }
            // Nothing written yet. The head stays — the stop button is useful whether or not
            // Claude Code has rendered a status line — and the rings go rather than showing zero,
            // which would read as "nothing used" instead of "not known yet".
            head.set(model: "", effort: nil)
            row.setItems([head])
            cwdLabel.stringValue = ""
            cwdLabel.isHidden = true
            return
        }

        head.set(model: snapshot.model, effort: snapshot.effort)

        var items: [NSView] = [head]
        for item in statusRings(snapshot, threshold: contextThreshold) {
            // Reused per name, not rebuilt: a fresh view on every poll would relayout the whole
            // row twice a second and lose the hover the pointer is sitting on.
            let group = groups[item.name] ?? {
                let made = StatusRingGroup(name: item.name)
                groups[item.name] = made
                return made
            }()
            let mode: StatusRingView.Mode
            switch item.fill {
            case .fraction(let value): mode = .fill(fraction: value)
            case .segments(let lit, let budget): mode = .segments(lit: lit, budget: budget)
            }
            group.set(mode: mode, level: item.level, value: item.value, sub: item.sub)
            group.toolTip = item.tooltip
            items.append(group)
        }
        row.setItems(items)

        cwdLabel.stringValue = snapshot.cwd.map { shortenPath($0) } ?? ""
        cwdLabel.toolTip = snapshot.cwd
        cwdLabel.isHidden = cwdLabel.stringValue.isEmpty
        invalidateLayout()
    }

    /// The Figma selection gets a band of its own above the separator, and the band disappears
    /// entirely when nothing is selected rather than leaving an empty line where it was.
    func renderSelection(_ nodes: [SelectedNode]) {
        defer { invalidateLayout() }
        let empty = nodes.isEmpty
        selectionRow.isHidden = empty
        separator.isHidden = empty
        guard !empty else { return }
        selectionButton.title = describeSelection(nodes)
        selectionButton.toolTip = (selectionPromptText(nodes) ?? "") + " — click to add to the prompt"
    }

    @objc private func selectionClicked() { onSelectionClick?() }

    /// The band's height is read in `PanelContentView.layout()`, which nothing schedules on its
    /// own — without this the row keeps the height it had before the content changed.
    private func invalidateLayout() {
        invalidateIntrinsicContentSize()
        needsLayout = true
        superview?.needsLayout = true
    }

    /// What the panel probe prints, in the same shape the bar version printed it.
    func measureBands() -> String {
        String(format: "height %.1f | fitting %.1f | selection %@",
               bounds.height, fittingSize.height, selectionRow.isHidden ? "hidden" : "shown")
    }

    override var intrinsicContentSize: NSSize {
        var height = 8 + row.intrinsicContentSize.height
        if !cwdLabel.isHidden { height += cwdLabel.fittingSize.height + 4 }
        if !selectionRow.isHidden { height += selectionRow.fittingSize.height + 4 }
        if !separator.isHidden { height += separator.fittingSize.height + 4 }
        return NSSize(width: NSView.noIntrinsicMetric, height: height)
    }

    /// Each item's width against the design's, so a wrap step that moves says which group moved it.
    func measureItems() -> String {
        let design: [String: CGFloat] = ["head": 79, "Ctx": 57, "Sess": 64, "Week": 86, "Comp": 64]
        var parts = [String(format: "head %.0f/%.0f", head.fittingSize.width, design["head"]!)]
        for name in ["Ctx", "Sess", "Week", "Comp"] {
            guard let group = groups[name] else { continue }
            parts.append(String(format: "%@ %.0f/%.0f", name, group.fittingSize.width, design[name]!))
        }
        return parts.joined(separator: "  ")
    }

    /// Where the rows actually sit, so a layout claim is a number rather than a look.
    func measure() -> String {
        String(format: "row %.0f…%.0f (h %.0f) | cwd %.0f…%.0f | total %.0f",
               row.frame.minY, row.frame.maxY, row.frame.height,
               cwdLabel.frame.minY, cwdLabel.frame.maxY, bounds.height)
    }

    /// Forces the stop button's hover state for the probe.
    func previewStopHover() { head.stop.previewHover() }
}
