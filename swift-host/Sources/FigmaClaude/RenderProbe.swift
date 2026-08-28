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
        // The health itself, not only the view derived from it: the toolbar's third light reads
        // the daemon's own answer, and a probe that leaves it nil paints a red circle for a state
        // the app would draw green.
        snapshot.health = Health(mode: "yolo", cdp: true, file: "Designdone – Figma")
        snapshot.status = toStatusView(snapshot.health)
        snapshot.file = "Designdone"
        snapshot.page = "CI"
        // The connected state, so the probe shows the three lights the toolbar draws rather than
        // the default "nothing has been polled yet".
        snapshot.figmaRunning = true
        snapshot.cdpOk = true
        toolbar.render(snapshot)
        if CommandLine.arguments.contains("--hover") { toolbar.previewHover() }
        toolbar.layoutSubtreeIfNeeded()

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

        // Measured here, and only after the bar has laid its own subviews out again: `canvas.layout()`
        // hands the toolbar its real frame, but the buttons inside it move on the *next* pass.
        // Without this the numbers describe the previous width — they said "labels off" for a
        // picture that plainly showed a truncated one.
        toolbar.layoutSubtreeIfNeeded()
        FileHandle.standardError.write(("[probe] toolbar " + toolbar.measureRow() + "\n").data(using: .utf8)!)
        FileHandle.standardError.write(("[probe] " + toolbar.measureCwd() + "\n").data(using: .utf8)!)

        // `--selection` after the first pass on purpose: that is the order the window sees it in,
        // a poll landing on a laid-out band. The band has to ask for a new pass itself, or its
        // rows are squeezed into the height they had without the selection.
        if CommandLine.arguments.contains("--selection") {
            statusLine.renderSelection([SelectedNode(id: "287:1495", name: "Hero", type: "FRAME")])
            // Deliberately not `layout()`: only `layoutSubtreeIfNeeded` respects the flag the
            // band sets, which is exactly the thing under test. Calling layout outright would
            // paper over a band that never asked for a new pass.
            canvas.layoutSubtreeIfNeeded()
        }
        FileHandle.standardError.write(
            ("[probe] status band " + statusLine.measureBands() + "\n").data(using: .utf8)!)

        guard let rep = canvas.bitmapImageRepForCachingDisplay(in: canvas.bounds) else { return }
        canvas.cacheDisplay(in: canvas.bounds, to: rep)
        guard let data = rep.representation(using: .png, properties: [:]) else { return }
        try? data.write(to: URL(fileURLWithPath: path))
        FileHandle.standardError.write("[probe] wrote \(path)\n".data(using: .utf8)!)
    }

    /// Does the status band grow when a Figma selection arrives — in a real window, after a real
    /// layout pass?
    ///
    /// The offscreen probes cannot answer this: they lay the canvas out by hand at the end, so a
    /// band that never asks for a new pass looks identical to one that does. Here the window runs
    /// its own layout, the selection lands afterwards the way a poll does, and the run loop gets
    /// its turn — which is the whole mechanism under test.
    static func selectionGrowth() {
        let toolbar = ToolbarView(frame: .zero)
        let strip = TabStripView(frame: .zero)
        let terminal = TerminalColumn()
        let statusLine = StatusLineView(frame: .zero)
        var snapshot = StatusLineSnapshot()
        snapshot.model = "Opus 5"
        snapshot.cwd = "~/Documents/DMA/Designdone/Business"
        snapshot.totalTokens = 1_000_000
        snapshot.usedTokens = 64_700
        snapshot.usedPercent = 6
        statusLine.render(snapshot)

        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 546, height: 700),
                              styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        let canvas = PanelContentView(frame: NSRect(x: 0, y: 0, width: 546, height: 700))
        canvas.toolbar = toolbar
        canvas.strip = strip
        canvas.terminal = terminal
        canvas.statusLine = statusLine
        for band in [toolbar, strip, terminal, statusLine] as [NSView] {
            band.translatesAutoresizingMaskIntoConstraints = true
            canvas.addSubview(band)
        }
        window.contentView = canvas
        window.orderBack(nil)
        window.displayIfNeeded()
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))

        let before = statusLine.measureBands()
        statusLine.renderSelection([SelectedNode(id: "287:1495", name: "Hero", type: "FRAME")])
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        window.displayIfNeeded()
        let after = statusLine.measureBands()

        print("before: \(before)")
        print("after:  \(after)")
        let grew = statusLine.bounds.height >= statusLine.fittingSize.height
        print(grew ? "PASS — the band is at least as tall as its content"
                   : "FAIL — content squeezed into the old height")
    }

    /// The three status rows as the menu draws them, with their positions printed. A menu cannot
    /// be photographed from a shell, but the views inside it can.
    static func menuRows(to path: String) {
        let rows = [
            StatusRow(label: "Figma", state: .ok, value: "running"),
            StatusRow(label: "CDP", state: .warn, value: "unused (plugin)"),
            StatusRow(label: "Daemon", state: .off, value: "not running")
        ]
        let views = rows.map { MenuStatusRowView($0) }
        let width = views.map(\.intrinsicContentSize.width).max() ?? 200
        let canvas = NSView(frame: NSRect(x: 0, y: 0, width: width, height: CGFloat(views.count) * 20))
        canvas.wantsLayer = true
        canvas.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        for (index, view) in views.enumerated() {
            view.frame = NSRect(x: 0, y: CGFloat(views.count - 1 - index) * 20, width: width, height: 20)
            canvas.addSubview(view)
            FileHandle.standardError.write(
                ("[probe] row \(rows[index].label) " + view.measure() + "\n").data(using: .utf8)!)
        }
        canvas.layoutSubtreeIfNeeded()

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
