import AppKit
import FigmaClaudeCore

/// Draws a view into a PNG without a screen.
///
/// `screencapture` needs Screen Recording permission, which a sandboxed shell does not have — it
/// returns the desktop picture with every window missing. `cacheDisplay` runs inside the process
/// and needs nothing, so a layout can be looked at instead of guessed at.
enum RenderProbe {
    /// The top bar and the tab strip, drawn side by side the way the window arranges them.
    static func chrome(width: CGFloat, tabs: Int, to path: String) {
        let toolbar = ToolbarView(frame: NSRect(x: 0, y: 0, width: width - TabStripView.stripWidth,
                                                height: ToolbarView.barHeight))
        toolbar.setDirectory("/Users/danielmartin/Documents/DMA/Designdone/Business")
        var snapshot = FigmaSnapshot.empty
        snapshot.status = toStatusView(Health(mode: "yolo", cdp: true, file: "Designdone – Figma"))
        snapshot.file = "Designdone"
        snapshot.page = "CI"
        toolbar.render(snapshot)
        if CommandLine.arguments.contains("--hover") { toolbar.previewHover() }
        toolbar.layoutSubtreeIfNeeded()
        FileHandle.standardError.write(("[probe] toolbar " + toolbar.measureRow() + "\n").data(using: .utf8)!)
        FileHandle.standardError.write(("[probe] " + toolbar.measureCwd() + "\n").data(using: .utf8)!)

        // Below the toolbar, as the window arranges it — a probe that draws it over the bar
        // would be showing something the app never renders.
        let strip = TabStripView(frame: NSRect(x: 0, y: 0, width: TabStripView.stripWidth,
                                               height: 190))
        strip.render(titles: (1...tabs).map { "Claude \($0)" },
                     tooltips: (1...tabs).map { "Claude \($0) — …/Business" },
                     activeIndex: min(2, tabs - 1),
                     waiting: tabs > 1 ? [1] : [])
        if CommandLine.arguments.contains("--hover") { strip.previewHover(at: 1) }
        strip.layoutSubtreeIfNeeded()
        FileHandle.standardError.write(("[probe] tab " + strip.measureTab(at: 1) + "\n")
            .data(using: .utf8)!)

        // The real content view, so the separators and the strip running to the bottom edge are
        // what the window actually draws rather than an approximation of it.
        let statusLine = StatusLineView(frame: .zero)
        var snap = StatusLineSnapshot()
        snap.model = "Opus 5"
        snap.effort = "high"
        snap.cwd = "~/Documents/DMA/Designdone/Business"
        snap.totalTokens = 1_000_000
        snap.usedTokens = 64_700
        snap.usedPercent = 6
        snap.sessionPercent = 41
        snap.weekPercent = 12
        statusLine.render(snap)

        // A real terminal view, not a coloured rectangle: the grey box beside the tab strip is
        // something SwiftTerm draws, and a stand-in cannot show it.
        // A view with no window inherits nothing, so the probe would always render light and
        // could never show a dark-mode fault.
        let column = TerminalColumn()
        column.appearance = NSApp.effectiveAppearance
        let real = MeteredTerminalView(frame: .zero)
        real.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        TerminalColumn.matchBackground(real, in: column)
        column.addSubview(real)
        column.hideScroller(in: real)
        let terminal: NSView = column
        FileHandle.standardError.write(
            "[probe] terminal bg \(real.nativeBackgroundColor)\n".data(using: .utf8)!)

        let canvas = PanelContentView(frame: NSRect(x: 0, y: 0, width: width, height: 220))
        canvas.wantsLayer = true
        canvas.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        canvas.toolbar = toolbar
        canvas.strip = strip
        canvas.terminal = terminal
        canvas.statusLine = statusLine
        for band in [toolbar, strip, terminal, statusLine] as [NSView] {
            band.translatesAutoresizingMaskIntoConstraints = true
            canvas.addSubview(band)
        }
        canvas.layout()

        guard let rep = canvas.bitmapImageRepForCachingDisplay(in: canvas.bounds) else { return }
        canvas.cacheDisplay(in: canvas.bounds, to: rep)
        guard let data = rep.representation(using: .png, properties: [:]) else { return }
        try? data.write(to: URL(fileURLWithPath: path))
        FileHandle.standardError.write("[probe] wrote \(path)\n".data(using: .utf8)!)
    }

    static func run(width: CGFloat, to path: String, danger: Bool = false) {
        let view = StatusLineView(frame: NSRect(x: 0, y: 0, width: width, height: 100))
        view.widthAnchor.constraint(equalToConstant: width).isActive = true
        view.layoutSubtreeIfNeeded()

        var snapshot = StatusLineSnapshot()
        snapshot.model = "Opus 5"
        snapshot.effort = "high"
        snapshot.cwd = "~/Documents/DMA/Designdone/Business"
        snapshot.totalTokens = 1_000_000
        snapshot.usedTokens = 64_700
        snapshot.usedPercent = danger ? 95 : 6
        snapshot.sessionPercent = danger ? 85 : 41
        snapshot.sessionResetsAt = Date().timeIntervalSince1970 + 7800
        snapshot.sessionResetsInMin = 130
        snapshot.weekPercent = danger ? 91 : 12
        snapshot.compacted = 3
        snapshot.compactBudget = 5
        view.render(snapshot)
        // `--no-selection` renders the state the band is hidden in, which is the one that must
        // not leave a gap.
        if !CommandLine.arguments.contains("--no-selection") {
            view.renderSelection([SelectedNode(id: "287:1495", name: "Hero", type: "FRAME")])
        }
        view.layoutSubtreeIfNeeded()
        // Size to content: the whole point of dropping the fixed height.
        let fitting = view.fittingSize
        view.frame = NSRect(x: 0, y: 0, width: width, height: fitting.height)
        view.layoutSubtreeIfNeeded()

        FileHandle.standardError.write(("[probe] " + view.measureContextRow() + "\n").data(using: .utf8)!)
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        guard let data = rep.representation(using: .png, properties: [:]) else { return }
        try? data.write(to: URL(fileURLWithPath: path))
        FileHandle.standardError.write("[probe] wrote \(path) at \(Int(width))×\(Int(view.frame.height))\n".data(using: .utf8)!)
    }
}
