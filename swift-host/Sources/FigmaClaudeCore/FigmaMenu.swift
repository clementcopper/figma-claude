import Foundation

/// Everything the Figma menu shows below its status rows, decided in one place.
///
/// The Electron host builds this in the renderer (`app/media/toolbar.js:264-356`) and decides each
/// item's enabled state there, mixed into DOM calls. Here the decision is a value: which sections
/// exist, what each item says, whether it can be clicked and what carries the selection mark. The
/// AppKit side only turns that into `NSMenuItem`s, so the rules can be checked without a window.

/// How an item shows that it is the current choice — the system's own tick, everywhere.
///
/// The green dot the Electron host uses for the mode rows was dropped here: in the status block
/// above them a dot means "this is running", and the same glyph two lines further down meaning
/// "this is selected" makes the reader work out which of the two it is each time.
public enum MenuMarker: Equatable { case none, check }

public enum MenuAction: Equatable {
    case connect
    case daemonRestart
    case daemonStop
    case bindFile(String)
    case undo
    case initAgent
    case setMode(FigmaMode)
    case setTheme(ThemeSetting)
}

public struct MenuItem: Equatable {
    public var title: String
    /// nil for a row that only reports something — the working directory's path line.
    public var action: MenuAction?
    public var enabled: Bool
    public var marker: MenuMarker
    /// The tooltip; the Electron host shows the same sentence as a hint under the pointer.
    public var hint: String?

    public init(title: String, action: MenuAction?, enabled: Bool,
                marker: MenuMarker = .none, hint: String? = nil) {
        self.title = title
        self.action = action
        self.enabled = enabled
        self.marker = marker
        self.hint = hint
    }
}

public struct MenuSection: Equatable {
    public var heading: String
    public var items: [MenuItem]

    public init(heading: String, items: [MenuItem]) {
        self.heading = heading
        self.items = items
    }
}

/// Is `Connect` worth offering — is the way to Figma actually missing?
///
/// Not the same question as "does the daemon report a connection". Stopping the daemon leaves
/// Figma running and its debug port open; the thing to press then is `Restart daemon`. And
/// `connect` is the one command that can quit a running Figma, so offering it where nothing is
/// broken is worse than merely useless.
public func connectNeeded(mode: FigmaMode, figmaRunning: Bool, cdpOk: Bool,
                          daemonSaysConnected: Bool) -> Bool {
    switch mode {
    // Both talk CDP: the way stands when Figma runs and the port answers, whatever the daemon is
    // doing at the moment.
    case .yolo, .browser: return !(figmaRunning && cdpOk)
    // Safe Mode has no port — the plugin's connection is only visible through the daemon, so its
    // answer is the only one available. Unknown counts as missing, and `connect --safe` cannot
    // quit anything.
    case .safe: return !daemonSaysConnected
    }
}

public struct FigmaMenuInput {
    public var figma: FigmaStatusView.State
    /// The two states the daemon cannot report about itself — the same ones the toolbar's lights
    /// are drawn from.
    public var figmaRunning: Bool
    public var cdpOk: Bool
    public var files: [OpenFile]
    public var configuredFile: String
    public var snapshotFile: String
    public var mode: FigmaMode
    public var theme: ThemeSetting
    public var undoNodes: [CreatedNode]
    public var cwd: String
    public var agentsReady: Bool
    public var cliFound: Bool
    /// One action at a time: each of them restarts the daemon or Figma underneath.
    public var busy: Bool

    public init(figma: FigmaStatusView.State, figmaRunning: Bool = false, cdpOk: Bool = false,
                files: [OpenFile] = [], configuredFile: String = "",
                snapshotFile: String = "", mode: FigmaMode = .yolo, theme: ThemeSetting = .system,
                undoNodes: [CreatedNode] = [], cwd: String = "", agentsReady: Bool = false,
                cliFound: Bool = true, busy: Bool = false) {
        self.figma = figma
        self.figmaRunning = figmaRunning
        self.cdpOk = cdpOk
        self.files = files
        self.configuredFile = configuredFile
        self.snapshotFile = snapshotFile
        self.mode = mode
        self.theme = theme
        self.undoNodes = undoNodes
        self.cwd = cwd
        self.agentsReady = agentsReady
        self.cliFound = cliFound
        self.busy = busy
    }
}

public func figmaMenuSections(_ input: FigmaMenuInput) -> [MenuSection] {
    var sections: [MenuSection] = []
    let usable = input.cliFound && !input.busy

    // Only worth a section when there is something to decide — one open file is not a choice.
    if input.files.count > 1 {
        sections.append(MenuSection(heading: "Bound file", items: input.files.map { file in
            MenuItem(title: file.title,
                     action: .bindFile(file.title),
                     enabled: !input.busy,
                     marker: boundFile(file, configured: input.configuredFile,
                                       snapshotFile: input.snapshotFile) ? .check : .none,
                     hint: "Point the daemon at this file")
        }))
    }

    sections.append(MenuSection(heading: "Connection", items: [
        MenuItem(title: input.busy ? "Working…" : "Connect", action: .connect,
                 enabled: usable && connectNeeded(mode: input.mode,
                                                  figmaRunning: input.figmaRunning,
                                                  cdpOk: input.cdpOk,
                                                  daemonSaysConnected: input.figma == .ok),
                 hint: "Patch, start Figma if needed, and bring the daemon up"),
        MenuItem(title: "Restart daemon", action: .daemonRestart, enabled: usable),
        MenuItem(title: "Stop daemon", action: .daemonStop, enabled: usable)
    ]))

    sections.append(MenuSection(heading: "Canvas", items: [
        MenuItem(title: undoLabel(input.undoNodes), action: .undo,
                 enabled: !input.busy && !input.undoNodes.isEmpty,
                 hint: "Removes only what the last render created")
    ]))

    sections.append(MenuSection(heading: "Working directory", items: [
        MenuItem(title: input.agentsReady ? "Rules up to date" : "Prepare this folder",
                 action: .initAgent,
                 enabled: usable && !input.agentsReady && !input.cwd.isEmpty,
                 hint: "Writes \(rulesFile) so Claude knows the CLI"),
        MenuItem(title: input.cwd.isEmpty ? "no folder chosen yet" : input.cwd,
                 action: nil, enabled: false)
    ]))

    sections.append(MenuSection(heading: "Mode", items: FigmaMode.allCases.map { mode in
        MenuItem(title: modeLabel(mode), action: .setMode(mode), enabled: !input.busy,
                 marker: mode == input.mode ? .check : .none)
    }))

    sections.append(MenuSection(heading: "Appearance", items: appearanceChoices.map { choice in
        MenuItem(title: choice.label, action: .setTheme(choice.setting), enabled: true,
                 marker: choice.setting == input.theme ? .check : .none)
    }))

    return sections
}

/// The line under the actions when the CLI is nowhere to be found — without it every item is
/// greyed out and nothing says why.
public func missingCliNote(cliFound: Bool) -> String? {
    cliFound ? nil : "figma-cli not found — set \"figmaCli\" in \(PanelConfig.path)"
}
