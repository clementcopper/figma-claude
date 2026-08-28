import AppKit
import FigmaClaudeCore

/// The bar across the top: where Claude is working on the left, what Figma is doing and what to
/// do about the session on the right.
///
/// The split is the point. Before this the row mixed status and actions in the order they were
/// added; now the left half answers "where am I" and the right half "what can I do".
final class ToolbarView: NSView {
    var onPickDirectory: (() -> Void)?
    var onFigmaMenu: ((NSButton) -> Void)?
    var onResume: (() -> Void)?
    var onContinue: (() -> Void)?
    var onRestart: (() -> Void)?

    /// Tall enough for the hover fields to have air above and below them. At 30 the field
    /// touched both edges of the bar and read as a stripe rather than a button.
    static let barHeight: CGFloat = 40

    private let cwdButton = IconLabelButton(symbol: "folder")
    private let figmaButton = HoverButton()
    private let statusDot = DotView()
    private var resumeButton = HoverButton()
    private var continueButton = HoverButton()
    private var restartButton = HoverButton()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true

        cwdButton.target = self
        cwdButton.action = #selector(pickDirectory)
        cwdButton.setContentCompressionResistancePriority(.init(250), for: .horizontal)

        figmaButton.bezelStyle = .inline
        figmaButton.isBordered = false
        figmaButton.font = .systemFont(ofSize: 11)
        figmaButton.target = self
        figmaButton.action = #selector(showFigmaMenu)
        figmaButton.lineBreakMode = .byTruncatingMiddle
        figmaButton.horizontalPadding = 7
        figmaButton.minimumHeight = 26
        // The file and page names are whatever Figma has open; they must never decide how wide
        // the window is.
        figmaButton.setContentCompressionResistancePriority(.init(300), for: .horizontal)

        // The three the extension's view/title group had, in that order. SF Symbols rather than
        // the panel's redrawn codicons: they carry the system's own weight and colour, which is
        // what makes a native toolbar look like one.
        resumeButton = iconButton(["clock.arrow.trianglehead.counterclockwise.rotate.90",
                                   "clock.arrow.circlepath"],
                                  "Resume Session in Current Tab…", #selector(resumeSession))
        continueButton = iconButton(["forward.frame"],
                                    "Continue Last Session in Current Tab", #selector(continueSession))
        restartButton = iconButton(["arrow.trianglehead.clockwise.rotate.90", "arrow.clockwise"],
                                   "Restart Terminal", #selector(restartSession))

        // The right half is its own stack so that only the empty spacer carries the fractional
        // remainder of the row's width. Flat, the leftover landed inside the icon group and put
        // one gap on a half point — measured 8, 7.5, 8.
        //
        // "New Tab" is deliberately absent: the strip on the right already carries a `+` that
        // does the same thing, and two identical buttons are not two features.
        let rightGroup = NSStackView(views: [statusDot, figmaButton,
                                             resumeButton, continueButton, restartButton])
        rightGroup.orientation = .horizontal
        rightGroup.spacing = 8
        rightGroup.alignment = .centerY
        rightGroup.setContentHuggingPriority(.required, for: .horizontal)

        let row = NSStackView(views: [cwdButton, spacer(), rightGroup])
        row.orientation = .horizontal
        row.spacing = 8
        row.alignment = .centerY
        row.edgeInsets = NSEdgeInsets(top: 0, left: 8, bottom: 0, right: 8)
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)

        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.topAnchor.constraint(equalTo: topAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor),
            statusDot.widthAnchor.constraint(equalToConstant: 7),
            statusDot.heightAnchor.constraint(equalToConstant: 7)
        ])
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    private func iconButton(_ symbols: [String], _ tooltip: String, _ action: Selector) -> HoverButton {
        let button = HoverButton()
        let (image, used) = symbolImage(symbols, describing: tooltip)
        button.image = image
        // Which name actually resolved, so a missing symbol is visible rather than an empty
        // square — the two `trianglehead` ones need macOS 15 and this machine runs 13.
        FileHandle.standardError.write(
            "[icon] \(symbols[0]) → \(used ?? "none")\n".data(using: .utf8)!)
        button.imagePosition = .imageOnly
        button.bezelStyle = .inline
        button.isBordered = false
        button.toolTip = tooltip
        button.target = self
        button.action = action
        button.setContentHuggingPriority(.required, for: .horizontal)
        // One size for all three: SF Symbols differ in their natural widths, and a row of icons
        // at unequal widths lands the gaps on half points — measured 8, 7.5, 8 before this. The
        // size carries the padding, so the hover field is the button itself.
        button.widthAnchor.constraint(equalToConstant: 26).isActive = true
        button.heightAnchor.constraint(equalToConstant: 26).isActive = true
        return button
    }

    /// An empty view that gives way before anything with content does — what separates the left
    /// half from the right one in a stack that otherwise packs everything to one side.
    private func spacer() -> NSView {
        let view = NSView()
        view.setContentHuggingPriority(.init(1), for: .horizontal)
        view.setContentCompressionResistancePriority(.init(1), for: .horizontal)
        return view
    }

    override func updateLayer() {
        layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
    }

    /// Draws one snapshot. The label comes from the same pure function the Electron host uses, so
    /// a difference between the two is a difference in the data, never in how it was phrased.
    func render(_ snapshot: FigmaSnapshot) {
        let connected = snapshot.status.figma == .ok
        statusDot.color = connected ? .systemGreen
            : (snapshot.status.daemon == .ok ? .systemOrange : .systemRed)

        figmaButton.title = figmaButtonLabel(daemon: snapshot.status.daemon,
                                             figma: snapshot.status.figma,
                                             file: snapshot.file, page: snapshot.page)
        figmaButton.toolTip = snapshot.status.tooltip
    }

    /// The folder name alone. The full path stays in the tooltip: it answers "which Business",
    /// which the name cannot, but it is evidence rather than a control and does not belong in a
    /// button that has to stay narrow.
    /// Where the icon and the title sit inside the cwd button — the padding claim is otherwise
    /// squinting at a screenshot.
    func measureCwd() -> String { "cwd " + cwdButton.measure() }

    /// Draws one button as if the pointer were on it, for the render probe.
    func previewHover() {
        continueButton.previewHover = true
        cwdButton.previewHover = true
    }

    func setDirectory(_ path: String) {
        cwdButton.text = (path as NSString).lastPathComponent
        cwdButton.toolTip = path + " — click to choose another"
    }

    /// Every gap in the row, measured after layout. Judging spacing by eye on a screenshot is
    /// guessing; these are the numbers.
    func measureRow() -> String {
        let items: [(String, NSView)] = [("cwd", cwdButton), ("dot", statusDot),
                                         ("figma", figmaButton), ("resume", resumeButton),
                                         ("continue", continueButton), ("restart", restartButton)]
        var parts: [String] = []
        for (index, item) in items.enumerated() {
            let frame = item.1.convert(item.1.bounds, to: self)
            parts.append(String(format: "%@ %.2f…%.2f", item.0, frame.minX, frame.maxX))
            if index + 1 < items.count {
                let next = items[index + 1].1
                let gap = next.convert(next.bounds, to: self).minX - frame.maxX
                parts.append(String(format: "[gap %.1f]", gap))
            }
        }
        return parts.joined(separator: " ")
    }

    @objc private func pickDirectory() { onPickDirectory?() }
    @objc private func showFigmaMenu() { onFigmaMenu?(figmaButton) }
    @objc private func resumeSession() { onResume?() }
    @objc private func continueSession() { onContinue?() }
    @objc private func restartSession() { onRestart?() }
}


/// The connection light. A drawn circle rather than a `●` glyph: a text field carries an
/// alignment inset that would make the gap beside it differ from every other gap in the row.
private final class DotView: NSView {
    var color: NSColor = .systemGray { didSet { needsDisplay = true } }

    override func draw(_ dirtyRect: NSRect) {
        color.setFill()
        NSBezierPath(ovalIn: bounds).fill()
    }
}
