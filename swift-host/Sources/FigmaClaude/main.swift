// Spike: does SwiftTerm carry Claude Code well enough to replace the Electron host?
//
// Step 0 answered the throughput and display questions; since then it has grown the parts of the
// panel that are pure logic — spawn options, the Figma poll, window bounds, and now tabs. It is
// still not the app: no toolbar, no status line, no Figma buttons.
//
//     .build/release/FigmaClaude                    the configured command, in the configured cwd
//     .build/release/FigmaClaude /bin/zsh -lc "…"   an explicit command, used by Tools/

import AppKit
import SwiftTerm
import FigmaClaudeCore

/// Wall-clock from the first byte of a burst to the last, printed to stderr.
///
/// A burst is "output with no gap longer than `idleGap`" — a crude definition, but the same one
/// applied to both hosts, and the comparison is what matters, not the absolute number.
final class ThroughputMeter {
    private var burstStart: Date?
    private var lastData: Date?
    private var bytes = 0
    private let idleGap: TimeInterval = 0.35
    private var timer: Timer?

    /// `dataReceived` runs on the reader queue, and a `Timer` scheduled there never fires — no
    /// run loop. Hopping to main is what makes the measurement exist at all.
    func record(_ count: Int) {
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in self?.record(count) }
            return
        }
        let now = Date()
        if burstStart == nil {
            burstStart = now
            bytes = 0
        }
        lastData = now
        bytes += count

        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: idleGap, repeats: false) { [weak self] _ in
            self?.finish()
        }
    }

    private func finish() {
        guard let start = burstStart, let end = lastData else { return }
        let seconds = end.timeIntervalSince(start)
        let kb = Double(bytes) / 1024
        // Sub-millisecond bursts are keystroke echo, not something worth a line.
        if seconds > 0.01 {
            FileHandle.standardError.write(
                String(format: "[spike] burst: %.1f KB in %.3f s (%.1f MB/s)\n",
                       kb, seconds, kb / 1024 / max(seconds, 0.0001)).data(using: .utf8)!)
        }
        burstStart = nil
        bytes = 0
    }
}

/// `dataReceived` is where `LocalProcess` hands the PTY output over — the only place the bytes
/// are visible before SwiftTerm swallows them. Timing it in the delegate measured nothing,
/// because the delegate never sees the data.
///
/// `Unhandle selector noop:` on stdout comes from SwiftTerm's own `doCommand(by:)` default branch
/// and means AppKit had no binding for a chord. Control keys are not affected — `keyDown` handles
/// those before `interpretKeyEvents`. What reached `noop:` in the first spike were ⌘-chords,
/// because there was no menu bar for them to hit; there is one now.
///
/// Worth knowing either way: `keyDown`, `flagsChanged` and `doCommand` are all `public override`
/// rather than `open`, so none of SwiftTerm's key handling can be corrected from outside the
/// module. Anything that needs changing there means forking the package.
final class MeteredTerminalView: LocalProcessTerminalView {
    let meter = ThroughputMeter()
    var sawOutput = false
    /// Called with everything the process writes, so the prompt detector can watch the tail.
    var onOutput: ((String) -> Void)?
    /// Called when the user types, so the dot clears before the next check runs.
    var onInput: (() -> Void)?

    override func dataReceived(slice: ArraySlice<UInt8>) {
        sawOutput = true
        meter.record(slice.count)
        if let onOutput {
            let text = String(decoding: slice, as: UTF8.self)
            DispatchQueue.main.async { onOutput(text) }
        }
        super.dataReceived(slice: slice)
    }

    /// `send` rather than `keyDown`: SwiftTerm marks its key handling `public override` rather
    /// than `open`, so it cannot be overridden from outside the module — but `send` is where
    /// every keystroke leaves for the PTY, and it is `open`.
    override func send(source: TerminalView, data: ArraySlice<UInt8>) {
        onInput?()
        super.send(source: source, data: data)
    }
}

/// The column the terminal sits in: padding around it, and the column painted in the terminal's
/// own colour.
///
/// Both halves are needed. The inset alone only revealed the window's grey underneath — the same
/// grey that showed as a strip beside the tabs when the terminal did not quite fill its column.
/// And the inset is applied here rather than at the call site because `show(_:)` can run before
/// the column has a size, where `insetBy` on an empty rect yields a negative one.
final class TerminalColumn: NSView {
    static let padding: CGFloat = 8

    /// Drawn, not stored as a `CGColor` on the layer. `NSColor.textBackgroundColor.cgColor`
    /// resolves against whatever appearance is current at the moment it is read, so a column
    /// painted once stayed light after the system went dark. Drawing asks the colour again on
    /// every pass, which is what makes it dynamic.
    override func draw(_ dirtyRect: NSRect) {
        NSColor.textBackgroundColor.setFill()
        dirtyRect.fill()
    }

    /// The terminal fills the same colour for everything outside its cells, and it holds an
    /// `NSColor`, so it follows the appearance on its own — but only if it is told again when
    /// the appearance changes.
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        for view in subviews {
            if let terminal = view as? TerminalView {
                Self.matchBackground(terminal, in: self)
            }
        }
        needsDisplay = true
    }

    override func layout() {
        super.layout()
        for view in subviews {
            view.frame = bounds.insetBy(dx: Self.padding, dy: Self.padding)
        }
    }

    /// Everything the terminal paints outside its cells — the strip below the last row, the
    /// area behind a hidden scroller — uses `nativeBackgroundColor`. On a fresh view that reads
    /// black while the cells are drawn white, which put a black bar under the terminal the
    /// moment the padding revealed it. Setting it makes the leftover match the column.
    /// SwiftTerm converts the colour to its own representation the moment it is assigned
    /// (`nativeBackgroundColor`'s setter calls `getTerminalColor()`), which freezes whichever
    /// appearance happened to be current. Resolving inside the view's own appearance is what
    /// makes a dark window get a dark terminal instead of a white rectangle.
    static func matchBackground(_ terminal: TerminalView, in view: NSView) {
        view.effectiveAppearance.performAsCurrentDrawingAppearance {
            terminal.nativeBackgroundColor = .textBackgroundColor
            terminal.nativeForegroundColor = .textColor
        }
    }

    /// SwiftTerm keeps an `NSScroller` at its trailing edge. Its style is `.overlay`, which is
    /// meant to auto-hide, but the slot stays drawn — a grey box between the terminal and the tab
    /// strip. The panel scrolls with the wheel and with Claude's own keys, so the control has
    /// nothing to add.
    func hideScroller(in terminal: NSView) {
        for view in terminal.subviews where view is NSScroller {
            view.isHidden = true
        }
    }
}

/// The four bands of the window, laid out by frame.
///
/// Deliberately not Auto Layout at this level. Pinning the bands to the content view's edges
/// makes AppKit derive the *window's* size from the layout — the stack trace named
/// `_changeWindowFrameFromConstraintsIfNecessary` — and that resolution takes the smallest legal
/// size, not the saved one. Measured: 380 asked, 272 given with a 240-point floor on the
/// terminal, 117 without it. `contentMinSize`, a low-priority width, an `==` on the column, an
/// intrinsic width and re-asserting the size after the first pass all still gave 272.
///
/// Positioning by frame takes the window out of that conversation: the window owns its size, and
/// Auto Layout is left to do what it is good at — the inside of each band.
final class PanelContentView: NSView {
    var toolbar: NSView?
    var strip: NSView?
    var terminal: NSView?
    var statusLine: NSView?

    /// One point each, drawn rather than laid out — three views with a colour would be three
    /// more things to keep in step with the bands they divide.
    private let lineWidth: CGFloat = 1

    override var isFlipped: Bool { false }

    override func layout() {
        super.layout()
        guard let toolbar, let strip, let terminal, let statusLine else { return }

        let width = bounds.width
        // The strip runs from under the toolbar to the bottom edge, so the status line ends at
        // it rather than passing underneath.
        let stripWidth = min(TabStripView.stripWidth, width)
        let leftWidth = max(0, width - stripWidth - lineWidth)

        // Width first, then ask how tall it needs to be. Asked the other way round the status
        // line answers for a zero-width column, where its text wraps — measured a 1387-point
        // window for a 700-point one.
        statusLine.setFrameSize(NSSize(width: leftWidth, height: statusLine.frame.height))
        statusLine.layoutSubtreeIfNeeded()
        let statusHeight = min(statusLine.fittingSize.height, bounds.height / 2)

        toolbar.frame = NSRect(x: 0, y: bounds.height - ToolbarView.barHeight,
                               width: width, height: ToolbarView.barHeight)
        strip.frame = NSRect(x: width - stripWidth, y: 0, width: stripWidth,
                             height: max(0, bounds.height - ToolbarView.barHeight - lineWidth))
        statusLine.frame = NSRect(x: 0, y: 0, width: leftWidth, height: statusHeight)

        let middleTop = bounds.height - ToolbarView.barHeight - lineWidth
        terminal.frame = NSRect(x: 0, y: statusHeight + lineWidth, width: leftWidth,
                                height: max(0, middleTop - statusHeight - lineWidth))
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        NSColor.separatorColor.setFill()

        let stripWidth = min(TabStripView.stripWidth, bounds.width)
        let leftWidth = max(0, bounds.width - stripWidth - lineWidth)
        let statusHeight = statusLine?.frame.height ?? 0

        // Under the toolbar, across the whole width.
        bounds.divided(atDistance: ToolbarView.barHeight + lineWidth, from: .maxYEdge)
            .slice.divided(atDistance: lineWidth, from: .minYEdge).slice.fill()
        // Left of the strip, from the toolbar down to the bottom edge.
        NSRect(x: leftWidth, y: 0, width: lineWidth,
               height: bounds.height - ToolbarView.barHeight - lineWidth).fill()
        // Above the status line, only as far as the strip.
        NSRect(x: 0, y: statusHeight, width: leftWidth, height: lineWidth).fill()
    }
}

/// One tab: its terminal, its name, and where it started.
final class TerminalTab {
    let view: MeteredTerminalView
    let name: String
    let cwd: String
    /// What the status line producer names its file after. Not the display name: that changes
    /// with the counter, and a file left behind would reappear under a later tab.
    let id: String
    let spawnedAt = Date()

    /// `id` is carried over when a tab is respawned: the status line is keyed on it, and a new
    /// one would point the row at a tab that no longer exists.
    init(view: MeteredTerminalView, name: String, cwd: String, id: String? = nil) {
        self.view = view
        self.name = name
        self.cwd = cwd
        self.id = id ?? "tab-\(UUID().uuidString.prefix(8))"
    }
}

final class PanelWindowController: NSObject, LocalProcessTerminalViewDelegate, NSWindowDelegate {
    let window: NSWindow
    private let tabStrip = TabStripView()
    private let toolbar = ToolbarView()
    private let statusLine = StatusLineView()
    private var statusWatcher: StatusLineWatcher!
    private var prompts: PromptDetector!
    /// Tabs whose process is being replaced on purpose — their exit is not worth reporting.
    private var respawning: Set<String> = []
    private lazy var cli = resolveCli(appRoot: Bundle.main.bundlePath, configured: PanelConfig.load().figmaCli)
    private let container = TerminalColumn()
    /// What the terminal column should be. The window has no other opinion about its width.
    private var state = TabState<TerminalTab>()
    private let watcher: FigmaWatcher

    /// An explicit command from the command line, used by the probes in `Tools/`. It applies to
    /// the first tab only — every tab after it is a real panel tab.
    private let commandOverride: [String]

    override init() {
        commandOverride = Array(CommandLine.arguments.dropFirst())

        // Where the window was last time, pulled back onto an attached screen if the monitor it
        // was parked on is gone.
        let screens = NSScreen.screens.map {
            WorkArea(x: $0.visibleFrame.origin.x, y: $0.visibleFrame.origin.y,
                     width: $0.visibleFrame.width, height: $0.visibleFrame.height)
        }
        let saved = clampBounds(loadBounds(), workAreas: screens)

        let frame = NSRect(x: saved.x ?? 0, y: saved.y ?? 0, width: saved.width, height: saved.height)

        window = NSWindow(contentRect: frame,
                          styleMask: [.titled, .closable, .resizable, .miniaturizable],
                          backing: .buffered, defer: false)
        var render: ((FigmaSnapshot) -> Void)?
        watcher = FigmaWatcher { snapshot in render?(snapshot) }
        super.init()
        render = { [weak self] snapshot in
            self?.toolbar.render(snapshot)
            self?.statusLine.renderSelection(snapshot.selection)
        }
        watcher.start()

        let config = PanelConfig.load()
        let dark = NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        let theme = resolveTheme(setting: ThemeSetting(rawValue: config.theme), systemPrefersDark: dark)
        window.appearance = NSAppearance(named: theme == .dark ? .darkAqua : .aqua)
        window.title = "FigmaClaude"
        window.delegate = self
        // An explicit floor, so the answer to "how narrow may this be" is a decision rather than
        // whatever the longest label happened to be.
        window.contentMinSize = NSSize(width: 320, height: 240)

        let content = PanelContentView(frame: NSRect(origin: .zero, size: frame.size))
        content.toolbar = toolbar
        content.strip = tabStrip
        content.terminal = container
        content.statusLine = statusLine
        for band in [toolbar, tabStrip, container, statusLine] as [NSView] {
            band.translatesAutoresizingMaskIntoConstraints = true
            content.addSubview(band)
        }
        window.contentView = content
        window.setContentSize(NSSize(width: saved.width, height: saved.height))

        // Full height at launch, and the height alone is not remembered: the panel stands beside
        // Figma for a whole session, and the useful height is always "as much as the screen has".
        // The width is the part worth keeping — that is what gets matched to the Figma window.
        //
        // Set as a *frame*, not a content size. The title bar is part of the frame, so asking for
        // a content height of the full visible area produces a window 28 points too tall and
        // AppKit clamps it — measured 1415 asked, 1387 given.
        //
        // `visibleFrame`, not `frame`: the menu bar and the Dock are not ours to cover, and a
        // window that starts underneath them cannot be dragged back out.
        let home = NSScreen.screens.first {
            $0.frame.contains(NSPoint(x: saved.x ?? 0, y: saved.y ?? 0))
        } ?? NSScreen.main
        if let area = home?.visibleFrame {
            window.setFrame(NSRect(x: min(max(saved.x ?? area.minX, area.minX),
                                          area.maxX - saved.width),
                                   y: area.minY, width: saved.width, height: area.height),
                            display: false)
        }

        tabStrip.onSelect = { [weak self] in self?.activate($0) }
        tabStrip.onClose = { [weak self] in self?.closeTab(at: $0) }
        tabStrip.onNewTab = { [weak self] in self?.newTab() }
        toolbar.onPickDirectory = { [weak self] in self?.pickDirectory() }
        toolbar.onFigmaMenu = { [weak self] button in self?.showFigmaMenu(from: button) }
        toolbar.onResume = { [weak self] in self?.respawnActive(["--resume"]) }
        toolbar.onContinue = { [weak self] in self?.respawnActive(["--continue"]) }
        toolbar.onRestart = { [weak self] in self?.respawnActive([]) }
        statusLine.onSelectionClick = { [weak self] in self?.insertSelection() }
        statusWatcher = StatusLineWatcher { [weak self] tabId, snapshot in
            guard let self, self.state.active?.id == tabId else { return }
            self.statusLine.render(snapshot)
        }
        statusWatcher.start()
        prompts = PromptDetector { [weak self] _, _ in self?.refreshTabBar() }
        toolbar.setDirectory(config.resolvedCwd() ?? NSHomeDirectory())

        if saved.x == nil { window.center() }
        window.makeKeyAndOrderFront(nil)

        let got = window.contentRect(forFrameRect: window.frame)
        FileHandle.standardError.write(String(
            format: "[spike] content asked %.0f×%.0f, got %.0f×%.0f\n",
            frame.width, frame.height, got.width, got.height).data(using: .utf8)!)
    }

    /// This same binary, invoked as Claude Code's status line command. Nothing else has to be
    /// installed and nothing on the user's PATH is involved.
    static var statusLineCommand: String {
        shellPath(Bundle.main.executablePath ?? CommandLine.arguments[0]) + " --statusline"
    }

    // MARK: - Tabs

    func newTab() {
        let config = PanelConfig.load()
        let cwd = config.resolvedCwd() ?? NSHomeDirectory()

        // The Figma file makes the better half of the session name; the working directory is the
        // fallback while the daemon is unreachable. Waiting for the first poll is what stops the
        // first tab from always being named after the folder — the Electron host learned that the
        // hard way, and the fix has to be ported along with the feature.
        watcher.waitForFirstPoll()
        let snapshot = watcher.snapshot
        let file = snapshot.file.isEmpty ? config.figmaFile : snapshot.file
        let sessionName = panelSessionName(file: file, cwd: cwd)
        let name = state.nextName()
        let view = MeteredTerminalView(frame: container.bounds)
        let tab = TerminalTab(view: view, name: name, cwd: cwd)
        let environment = panelEnvironment(config: config, tabId: tab.id)

        view.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        view.processDelegate = self
        view.onOutput = { [weak self] text in self?.prompts.onData(tab.id, text) }
        view.onInput = { [weak self] in self?.prompts.onUserInput(tab.id) }

        let executable: String
        let args: [String]
        if state.count == 0, !commandOverride.isEmpty {
            executable = commandOverride[0]
            args = Array(commandOverride.dropFirst())
        } else {
            guard let resolved = whichOnPath(config.command, path: environment["PATH"] ?? "") else {
                FileHandle.standardError.write(
                    "[spike] \(config.command) is not on the PATH this window sees\n".data(using: .utf8)!)
                return
            }
            executable = resolved
            args = panelArguments(config: config, sessionName: sessionName,
                                  statusLineCommand: Self.statusLineCommand)
        }

        FileHandle.standardError.write(
            ("[spike] tab \(name): \(executable) \(args.joined(separator: " ")) " +
             "cwd=\(cwd) figma=\(snapshot.status.tooltip)\n").data(using: .utf8)!)

        state.append(tab)
        show(tab)
        view.startProcess(executable: executable, args: args,
                          environment: environment.map { "\($0.key)=\($0.value)" },
                          currentDirectory: cwd)
        refreshTabBar()
    }

    private func show(_ tab: TerminalTab) {
        container.subviews.forEach { $0.removeFromSuperview() }
        // `textBackgroundColor`, not the terminal's `nativeBackgroundColor`: that property reads
        // black on an unconfigured view while the grid is drawn white, so painting the column
        // from it framed the terminal in black.
        TerminalColumn.matchBackground(tab.view, in: container)
        container.addSubview(tab.view)
        container.hideScroller(in: tab.view)
        container.needsLayout = true
        window.makeFirstResponder(tab.view)
        // Here rather than at each call site: three places bring a tab to the front, and a row
        // that is only redrawn in one of them shows the previous tab's numbers in the other two.
        statusLine.render(statusWatcher.snapshot(for: tab.id))
    }

    func activate(_ index: Int) {
        state.activate(index)
        if let tab = state.active { show(tab) }
        refreshTabBar()
    }

    func closeTab(at index: Int) {
        guard let removed = state.close(index) else { return }
        statusWatcher.forget(removed.id)
        prompts.forget(removed.id)
        removed.view.terminate()
        removed.view.removeFromSuperview()

        if let tab = state.active {
            show(tab)
            refreshTabBar()
        } else {
            // The last tab closing takes the window with it — a panel with no terminal is an
            // empty rectangle nobody asked for.
            window.close()
        }
    }

    func closeActiveTab() {
        guard let index = state.activeIndex else { return }
        closeTab(at: index)
    }

    func cycleTab(by offset: Int) {
        state.cycle(by: offset)
        if let tab = state.active { show(tab) }
        refreshTabBar()
    }

    /// Where the window size goes missing, if it does. Cheap enough to leave in while the
    /// layout is still moving.


    func traceSize(_ what: String) {
        let c = window.contentRect(forFrameRect: window.frame)
        FileHandle.standardError.write(String(format: "[spike] %@: content %.0f×%.0f\n",
                                              what, c.width, c.height).data(using: .utf8)!)
    }

    private func refreshTabBar() {
        let waiting = Set(state.tabs.enumerated()
            .filter { prompts.isWaiting($0.element.id) }
            .map(\.offset))
        tabStrip.render(titles: state.tabs.map(\.name),
                        tooltips: state.tabs.map { "\($0.name) — \(shortenPath($0.cwd))" },
                        activeIndex: state.activeIndex,
                        waiting: waiting)
    }

    // MARK: - The four things a plain terminal cannot do

    /// Connecting is the panel's job, never Claude's — the project rules say so, and the CLI's
    /// own `connect` is the one command that can quit a running Figma if it gets it wrong.
    private func connect() {
        runInBackground(title: "Connect") { runCli(self.cli, ["connect"]) }
    }

    /// Writes the selection into the active terminal's input without a newline: sending it stays
    /// the user's decision. Ids, not just names — those are what `get`, `set` and
    /// `render --parent` take.
    private func insertSelection() {
        guard let text = selectionPromptText(watcher.snapshot.selection),
              let tab = state.active else { return }
        // Bracketed paste, so a multi-line selection arrives as one paste rather than as
        // newlines the prompt would submit on.
        tab.view.send(txt: "\u{1b}[200~" + text + "\u{1b}[201~")
        window.makeFirstResponder(tab.view)
    }

    private func undoRender() {
        runInBackground(title: "Undo last render") { CliResult(ok: true, output: undoLastRender()) }
    }

    /// Claude Code keeps its session history per directory, so moving a tab means restarting it —
    /// the process cannot be moved, only replaced.
    private func pickDirectory() {
        let panel = NSOpenPanel()
        panel.title = "Working directory for Claude"
        panel.message = "Claude Code keeps its session history per directory."
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Use this folder"
        if let current = PanelConfig.load().resolvedCwd() {
            panel.directoryURL = URL(fileURLWithPath: current)
        }
        guard panel.runModal() == .OK, let chosen = panel.url?.path else { return }

        writeConfiguredCwd(chosen)
        toolbar.setDirectory(chosen)
        // Replace the active tab so the new directory actually applies.
        if let index = state.activeIndex {
            closeTab(at: index)
        }
        newTab()
    }

    /// panel.json is shared with the Electron host, so only the one key is rewritten — anything
    /// else in the file belongs to whoever put it there.
    private func writeConfiguredCwd(_ path: String) {
        let file = PanelConfig.path
        var object: [String: Any] = [:]
        if let data = FileManager.default.contents(atPath: file),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            object = parsed
        }
        object["cwd"] = path
        guard let out = try? JSONSerialization.data(withJSONObject: object,
                                                    options: [.prettyPrinted, .sortedKeys]) else { return }
        try? out.write(to: URL(fileURLWithPath: file))
    }

    /// Runs a CLI action off the main thread and reports it in a sheet. `connect` can take
    /// seconds — doing it inline would freeze the terminal it exists to serve.
    private func runInBackground(title: String, _ work: @escaping () -> CliResult) {
        DispatchQueue.global(qos: .userInitiated).async {
            let result = work()
            DispatchQueue.main.async {
                let alert = NSAlert()
                alert.messageText = title
                alert.informativeText = result.output.isEmpty ? "Done." : result.output
                alert.alertStyle = result.ok ? .informational : .warning
                alert.beginSheetModal(for: self.window)
            }
        }
    }


    /// Kills the active tab's process and starts it again **in the tab's own directory**.
    ///
    /// Port of `respawnActive` in `app/src/main.ts`. Without that cwd the new PTY falls back
    /// elsewhere, which silently changes which session history applies — the whole point of the
    /// three buttons is that they act on *this* conversation.
    ///
    /// The tab keeps its place and its id: the status line is keyed on that id, and a new one
    /// would point the row at a tab that no longer exists.
    private func respawnActive(_ extraArgs: [String]) {
        guard let index = state.activeIndex, let old = state.tabs.first(where: { $0.id == state.tabs[index].id })
        else { return }

        let config = PanelConfig.load()
        let environment = panelEnvironment(config: config, tabId: old.id)
        guard let executable = whichOnPath(config.command, path: environment["PATH"] ?? "") else { return }

        let snapshot = watcher.snapshot
        let file = snapshot.file.isEmpty ? config.figmaFile : snapshot.file
        let sessionName = panelSessionName(file: file, cwd: old.cwd)
        var args = panelArguments(config: config, sessionName: sessionName,
                                  statusLineCommand: Self.statusLineCommand)
        args.append(contentsOf: extraArgs)

        respawning.insert(old.id)
        old.view.terminate()
        old.view.removeFromSuperview()
        prompts.forget(old.id)

        let view = MeteredTerminalView(frame: container.bounds)
        view.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        view.processDelegate = self
        view.onOutput = { [weak self] text in self?.prompts.onData(old.id, text) }
        view.onInput = { [weak self] in self?.prompts.onUserInput(old.id) }

        let replacement = TerminalTab(view: view, name: old.name, cwd: old.cwd, id: old.id)
        state.replace(at: index, with: replacement)
        show(replacement)
        view.startProcess(executable: executable, args: args,
                          environment: environment.map { "\($0.key)=\($0.value)" },
                          currentDirectory: old.cwd)
        respawning.remove(old.id)
        refreshTabBar()
    }

    /// The status readout and the actions behind it, as a menu rather than the popover the web
    /// UI builds. The rows are what `bin/fig-status` prints, so the two cannot drift apart.
    private func showFigmaMenu(from button: NSButton) {
        let snapshot = watcher.snapshot
        let menu = NSMenu()

        for row in statusRows(figmaRunning: isFigmaRunning(), cdpOk: isCdpReachable(port: 9222),
                              cdpPort: 9222, health: snapshot.health) {
            let mark: String
            switch row.state {
            case .ok: mark = "●"
            case .warn: mark = "◐"
            case .off: mark = "○"
            }
            let item = menu.addItem(withTitle: "\(mark)  \(row.label): \(row.value)",
                                    action: nil, keyEquivalent: "")
            item.isEnabled = false
        }

        menu.addItem(.separator())

        let connect = menu.addItem(withTitle: "Connect", action: #selector(menuConnect),
                                   keyEquivalent: "")
        connect.target = self
        // Never while it is already connected — the CLI's own `connect` can quit a running Figma.
        connect.isEnabled = snapshot.status.figma != .ok

        let nodes = parseLastRender(try? String(contentsOfFile: lastRenderFile, encoding: .utf8))
        let undo = menu.addItem(withTitle: undoLabel(nodes), action: #selector(menuUndo),
                                keyEquivalent: "")
        undo.target = self
        undo.isEnabled = !nodes.isEmpty

        menu.popUp(positioning: nil,
                   at: NSPoint(x: 0, y: button.bounds.height + 4), in: button)
    }

    @objc private func menuConnect() { connect() }
    @objc private func menuUndo() { undoRender() }

    // MARK: - LocalProcessTerminalViewDelegate

    func sizeChanged(source: LocalProcessTerminalView, newCols: Int, newRows: Int) {}

    func setTerminalTitle(source: LocalProcessTerminalView, title: String) {
        window.title = title.isEmpty ? "FigmaClaude" : title
    }

    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}

    /// A process that ended writes its epitaph **into its own tab**, and the tab stays.
    ///
    /// The first version closed the tab here and, when it was the last one, the window with it —
    /// so anything that ended Claude Code took the whole app down. The Electron host never did
    /// that (`app/src/main.ts:738`): it posts the line into the terminal and leaves everything
    /// standing, which is what lets you read why it exited and press Restart.
    func processTerminated(source: TerminalView, exitCode: Int32?) {
        guard let index = state.tabs.firstIndex(where: { $0.view === source }) else { return }
        // A deliberate respawn ends the old process on purpose; saying so would be noise.
        guard !respawning.contains(state.tabs[index].id) else { return }

        let tab = state.tabs[index]
        tab.view.feed(text: describePtyExit(
            code: exitCode ?? 0,
            msSinceSpawn: Date().timeIntervalSince(tab.spawnedAt) * 1000,
            sawOutput: tab.view.sawOutput))
    }

    // MARK: - NSWindowDelegate

    /// Three guesses at what shrank the window were all wrong, so this asks instead: who is on
    /// the stack the first time it resizes itself.
    /// The window derives its own frame from the layout — the stack trace named
    /// `_changeWindowFrameFromConstraintsIfNecessary` — and with nothing in the chrome preferring
    /// a width it lands on the smallest legal one: 272 points for a saved 380. Neither
    /// `contentMinSize`, a low-priority width, nor taking the content view out of Auto Layout
    /// changed that.
    ///
    /// So the size is re-asserted once, after that first pass. It only fires while a restore is
    /// pending, and never during a drag, so it cannot fight the user.
    /// Only while the user is dragging. Following every resize would mean writing the window's
    /// own shrink back as the target and cementing it — which is exactly what happened.
    /// The bands are positioned by frame, so a resize needs nothing but a fresh layout pass —
    /// which AppKit already schedules. Kept for the window-size trace while the layout settles.
    func windowDidResize(_ notification: Notification) {
        window.contentView?.needsLayout = true
    }


    /// A window position is only worth remembering if it is written down before the app dies.
    func windowWillClose(_ notification: Notification) {
        // The *content* rect, not the frame: the frame carries the title bar, and handing that
        // back to `NSWindow(contentRect:)` on the next launch made the window 28 points taller
        // every time it was opened. It looked like it settled only because it was hitting the
        // top of the screen.
        let f = window.contentRect(forFrameRect: window.frame)
        FileHandle.standardError.write(String(
            format: "[spike] closing with content %.0f×%.0f (min %.0f×%.0f)\n",
            f.width, f.height, window.contentMinSize.width, window.contentMinSize.height)
                .data(using: .utf8)!)
        saveBounds(Bounds(x: window.frame.origin.x, y: window.frame.origin.y,
                          width: f.width, height: f.height))
        watcher.stop()
        NSApp.terminate(nil)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var controller: PanelWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        let controller = PanelWindowController()
        self.controller = controller
        controller.newTab()
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Without a menu every ⌘-chord falls through the responder chain to `noop:`, which SwiftTerm
    /// drops with a line on stdout. The menu is what gives them somewhere to go.
    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About FigmaClaude", action: #selector(showAbout), keyEquivalent: "")
            .target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        let tabItem = NSMenuItem()
        let tabMenu = NSMenu(title: "Tabs")
        tabMenu.addItem(withTitle: "New Tab", action: #selector(newTab), keyEquivalent: "t").target = self
        tabMenu.addItem(withTitle: "Close Tab", action: #selector(closeTab), keyEquivalent: "w").target = self
        tabMenu.addItem(.separator())
        let next = tabMenu.addItem(withTitle: "Next Tab", action: #selector(nextTab), keyEquivalent: "\u{0009}")
        next.keyEquivalentModifierMask = [.control]
        next.target = self
        let prev = tabMenu.addItem(withTitle: "Previous Tab", action: #selector(previousTab), keyEquivalent: "\u{0009}")
        prev.keyEquivalentModifierMask = [.control, .shift]
        prev.target = self
        tabItem.submenu = tabMenu
        main.addItem(tabItem)

        NSApp.mainMenu = main
    }

    @objc private func newTab() { controller?.newTab() }
    @objc private func closeTab() { controller?.closeActiveTab() }
    @objc private func nextTab() { controller?.cycleTab(by: 1) }
    @objc private func previousTab() { controller?.cycleTab(by: -1) }

    @objc private func showAbout() {
        let alert = NSAlert()
        alert.messageText = "FigmaClaude"
        alert.informativeText = aboutCredits(cliVersion: cliVersion())
        alert.runModal()
    }

    /// The CLI's own version, read the way the About dialog does it — the last line that looks
    /// like a version, so a shell error never appears as a number.
    private func cliVersion() -> String? {
        let path = LoginShellPath.resolve() ?? ProcessInfo.processInfo.environment["PATH"] ?? ""
        guard let cli = whichOnPath("figma-cli", path: path) else { return nil }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: cli)
        process.arguments = ["--version"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        guard (try? process.run()) != nil else { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return parseCliVersion(String(decoding: data, as: UTF8.self))
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

// Claude Code invokes this same binary as its `statusLine` command and pushes the session data
// in on stdin. No window, no AppKit — read, write the snapshot, leave. Printing nothing is part
// of the contract: the window draws the row, so any output here would show up twice.
if CommandLine.arguments.contains("--statusline") {
    runStatusLineProducer()
    exit(0)
}

// Draw the status line into a PNG and exit — the only way to look at the layout from a shell
// that has no Screen Recording permission.
if let index = CommandLine.arguments.firstIndex(of: "--render-chrome") {
    _ = NSApplication.shared
    let tabs = CommandLine.arguments.count > index + 1
        ? Int(CommandLine.arguments[index + 1]) ?? 4 : 4
    RenderProbe.chrome(width: 546, tabs: tabs, to: "/tmp/chrome.png")
    exit(0)
}

if let index = CommandLine.arguments.firstIndex(of: "--render-statusline") {
    _ = NSApplication.shared
    let width = CommandLine.arguments.count > index + 1
        ? Double(CommandLine.arguments[index + 1]) ?? 546 : 546
    RenderProbe.run(width: width, to: "/tmp/statusline.png",
                    danger: CommandLine.arguments.contains("--danger"))
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
