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

        row.translatesAutoresizingMaskIntoConstraints = false
        row.onHeightChange = { [weak self] in self?.invalidateIntrinsicContentSize() }
        addSubview(row)
        addSubview(cwdLabel)

        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.topAnchor.constraint(equalTo: topAnchor, constant: 4),
            cwdLabel.topAnchor.constraint(equalTo: row.bottomAnchor, constant: 4),
            cwdLabel.leadingAnchor.constraint(equalTo: leadingAnchor,
                                              constant: StatusRingRow.horizontalPadding),
            cwdLabel.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor,
                                               constant: -StatusRingRow.horizontalPadding),
            cwdLabel.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -4)
        ])
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func updateLayer() {
        layer?.backgroundColor = StatusPalette.ground.cgColor
    }

    func render(_ snapshot: StatusLineSnapshot?) {
        lastSnapshot = snapshot

        guard let snapshot, !snapshot.isEmpty else {
            // Nothing written yet. The head stays — the stop button is useful whether or not
            // Claude Code has rendered a status line — and the rings go rather than showing zero,
            // which would read as "nothing used" instead of "not known yet".
            head.set(model: "", effort: nil)
            row.setItems([head])
            cwdLabel.stringValue = ""
            invalidateIntrinsicContentSize()
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
        invalidateIntrinsicContentSize()
    }

    override var intrinsicContentSize: NSSize {
        let rowHeight = row.intrinsicContentSize.height
        let cwdHeight = cwdLabel.stringValue.isEmpty ? 0 : cwdLabel.fittingSize.height + 4
        return NSSize(width: NSView.noIntrinsicMetric, height: 4 + rowHeight + cwdHeight + 4)
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
