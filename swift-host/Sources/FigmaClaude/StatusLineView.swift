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

    private let selectionButton = NSButton()
    private let selectionRow = NSStackView()
    private let separator = NSBox()

    private let modelLabel = TightLabel(labelWithString: "")
    private let effortPill = PillView()
    private let bar = BarView()
    private let percentLabel = TightLabel(labelWithString: "")
    private let tokensLabel = TightLabel(labelWithString: "")
    private let limitLeft = TightLabel(labelWithString: "")
    private let compactedLabel = TightLabel(labelWithString: "")
    private let limitRight = TightLabel(labelWithString: "")
    private let cwdLabel = TightLabel(labelWithString: "")

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true

        for label in [modelLabel, percentLabel, tokensLabel,
                      limitLeft, compactedLabel, limitRight, cwdLabel] {
            label.font = .systemFont(ofSize: 10)
            label.textColor = .secondaryLabelColor
        }
        modelLabel.font = .systemFont(ofSize: 10, weight: .medium)
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

        cwdLabel.lineBreakMode = .byTruncatingHead
        cwdLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        selectionButton.isBordered = false
        selectionButton.font = .systemFont(ofSize: 10)
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

    /// A tab Claude has not rendered in yet carries no numbers — the row stays empty rather than
    /// showing a full bar reading `0 / 0`.
    func render(_ snapshot: StatusLineSnapshot?) {
        guard let snapshot, !snapshot.isEmpty else {
            for label in [modelLabel, percentLabel, tokensLabel,
                          limitLeft, compactedLabel, limitRight, cwdLabel] {
                label.stringValue = ""
            }
            effortPill.isHidden = true
            bar.isHidden = true
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

        // One name for the level, so bar and figure can never disagree.
        let level = contextLevel(snapshot.usedPercent)
        bar.fraction = min(1, max(0, snapshot.usedPercent / 100))
        bar.color = color(for: level)
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
        label.font = .systemFont(ofSize: 9, weight: .semibold)
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
private final class BarView: NSView {
    var fraction: Double = 0 { didSet { needsDisplay = true } }
    var color: NSColor = .systemBlue { didSet { needsDisplay = true } }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.separatorColor.setFill()
        NSBezierPath(roundedRect: bounds, xRadius: 2, yRadius: 2).fill()
        guard fraction > 0 else { return }
        let filled = NSRect(x: 0, y: 0, width: bounds.width * fraction, height: bounds.height)
        color.setFill()
        NSBezierPath(roundedRect: filled, xRadius: 2, yRadius: 2).fill()
    }
}
