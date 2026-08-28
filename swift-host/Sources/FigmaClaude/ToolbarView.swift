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
    /// Three lights inside the button, not beside it — the same three the menu lists: Figma, the
    /// debug port, the daemon. One source for both (`statusRows`), so a light and the row above it
    /// can never say different things. Outside the button, the hover field ended where the state
    /// began.
    private let figmaButton = IconLabelButton(icons: [nil, nil, nil], spacing: 5, padding: 7)
    /// The label the last poll produced, restored when a toast expires.
    private var lastLabel = "offline"
    private var resumeButton = HoverButton()
    /// While a toast is up, the poll must not paint the file name back over it.
    private var toastUntil: Date?
    private var continueButton = HoverButton()
    private var restartButton = HoverButton()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true

        cwdButton.target = self
        cwdButton.action = #selector(pickDirectory)
        cwdButton.setContentCompressionResistancePriority(.init(250), for: .horizontal)

        figmaButton.target = self
        figmaButton.action = #selector(showFigmaMenu)
        // The file and page names are whatever Figma has open; they must never decide how wide
        // the window is.
        figmaButton.setContentCompressionResistancePriority(.init(200), for: .horizontal)

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
        let rightGroup = NSStackView(views: [figmaButton,
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
            row.bottomAnchor.constraint(equalTo: bottomAnchor)
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

    /// Who gives way, and by how much.
    ///
    /// Not left to the priorities: they decide *which* view is compressed, not what it does with
    /// the loss, and a text field handed too little space squeezes rather than shortens. Here the
    /// two labels are given an explicit width out of what the row has left over — the rule itself
    /// is `toolbarLabelBudgets`, so it can be checked without a window.
    override func layout() {
        super.layout()

        let icons = 3 * 26 + 2 * 8            // resume, continue, restart and the gaps between them
        // Both label gaps are taken off the top, even though a dropped label gives its own back:
        // counted the other way round the row came out ten points too wide at 340 — measured, the
        // icon group ran past the tab strip.
        // Five gaps of eight, not four: the row is [folder | spacer | right group], so the spacer
        // has one on each side, and the right group has one more between the Figma button and the
        // icons. Counting four put the row exactly eight points too wide at 360 — the trailing
        // inset vanished and the icons touched the tab strip.
        let fixed = 8 + cwdButton.minimumWidth
            + 8 + 8 + figmaButton.minimumWidth
            + 8 + CGFloat(icons) + 8
        let budgets = toolbarLabelBudgets(available: Double(bounds.width - fixed),
                                          cwdWanted: Double(cwdButton.labelWanted),
                                          figmaWanted: Double(figmaButton.labelWanted),
                                          cwdGap: Double(cwdButton.labelGap),
                                          figmaGap: Double(figmaButton.labelGap))
        cwdButton.setLabelBudget(CGFloat(budgets.cwd))
        figmaButton.setLabelBudget(CGFloat(budgets.figma))
        super.layout()
    }

    override func updateLayer() {
        layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
    }

    /// Draws one snapshot. The label comes from the same pure function the Electron host uses, so
    /// a difference between the two is a difference in the data, never in how it was phrased.
    func render(_ snapshot: FigmaSnapshot) {
        // Built from the menu's own rows, in the menu's order: Figma, CDP, Daemon.
        let rows = statusRows(figmaRunning: snapshot.figmaRunning, cdpOk: snapshot.cdpOk,
                              cdpPort: cdpPort, health: snapshot.health)
        figmaButton.setIcons(rows.map { statusIcon($0.state) })

        lastLabel = figmaButtonLabel(daemon: snapshot.status.daemon,
                                     figma: snapshot.status.figma,
                                     file: snapshot.file, page: snapshot.page)
        // The three rows in words, so the state is readable without opening the menu.
        figmaButton.toolTip = rows.map { "\($0.label): \($0.value)" }.joined(separator: " · ")
        // A poll lands every 2.5 s; without this it would wipe a message after a fraction of the
        // time it is meant to be readable.
        guard toastUntil == nil else { return }
        figmaButton.text = lastLabel
    }

    /// What an action did, where the file name usually is.
    ///
    /// The menu closes on the click that started the action, so a finished `Restart daemon` has
    /// nowhere else to report itself. Port of `panelToast` (`app/src/main.ts:697`), same 2.6 s.
    func toast(_ text: String) {
        let line = text.split(separator: "\n").last.map(String.init) ?? text
        figmaButton.text = line
        let until = Date().addingTimeInterval(2.6)
        toastUntil = until
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.6) { [weak self] in
            guard let self, self.toastUntil == until else { return }
            self.toastUntil = nil
            self.figmaButton.text = self.lastLabel
        }
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
        let items: [(String, NSView)] = [("cwd", cwdButton),
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
        // Whether the two labels are still there — "symbols only" has to be readable from the
        // measurement, not guessed at from the picture.
        parts.append("| labels cwd=\(cwdButton.hasLabel ? "on" : "off") "
                     + "figma=\(figmaButton.hasLabel ? "on" : "off")")
        return parts.joined(separator: " ")
    }

    @objc private func pickDirectory() { onPickDirectory?() }
    @objc private func showFigmaMenu() { onFigmaMenu?(figmaButton) }
    @objc private func resumeSession() { onResume?() }
    @objc private func continueSession() { onContinue?() }
    @objc private func restartSession() { onRestart?() }
}
