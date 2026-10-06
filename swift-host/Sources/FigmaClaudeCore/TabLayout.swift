import Foundation

/// The tabs as they were when the app last ran: what a restart puts back.
///
/// Each tab is restored with `claude --resume <sessionId>` in its folder, so the conversation
/// comes back, not only the window. Only the tab that was in front starts at once; the others
/// are cold until clicked — a Claude start costs 12–22 s and a process each. Modelled on the VS
/// Code extension's `persistLayout`/`restoreLayout`, which restores cold tabs but, lacking the
/// session id, fresh ones.
public struct SavedTab: Codable, Equatable {
    public var id: String
    public var name: String
    public var cwd: String
    /// Empty when the host never learned it (a `--resume` picker tab that never rendered): the
    /// tab then comes back as a fresh session in the same folder.
    public var sessionId: String
    public var sessionName: String

    public init(id: String, name: String, cwd: String, sessionId: String, sessionName: String) {
        self.id = id
        self.name = name
        self.cwd = cwd
        self.sessionId = sessionId
        self.sessionName = sessionName
    }
}

public let tabLayoutVersion = 1

public struct TabLayout: Codable, Equatable {
    /// Bumped when the shape changes; a file of another version is discarded, never guessed at.
    public var version: Int = tabLayoutVersion
    public var tabs: [SavedTab]
    public var activeIndex: Int
    /// `TabState`'s counter, so the next tab is "Claude N+1" rather than a second "Claude 1".
    public var counter: Int

    public init(tabs: [SavedTab], activeIndex: Int, counter: Int) {
        self.tabs = tabs
        self.activeIndex = activeIndex
        self.counter = counter
    }
}

/// Beside the window bounds: one directory holds the panel's state.
public let tabLayoutFile = NSHomeDirectory() + "/.figma-ds-cli/panel-tabs.json"

/// A corrupt file must not open hundreds of tabs. The extension's ceiling.
public let maxRestoredTabs = 16

/// Nil when there is no file, it does not parse, or another shape of the app wrote it.
public func loadTabLayout(from file: String = tabLayoutFile) -> TabLayout? {
    guard let data = FileManager.default.contents(atPath: file),
          let layout = try? JSONDecoder().decode(TabLayout.self, from: data),
          layout.version == tabLayoutVersion else { return nil }
    return layout
}

/// Atomic and mode 600 like `panel.json`: it names sessions. Every failure is silent — a tab
/// list is not worth an error dialog on the way out.
public func saveTabLayout(_ layout: TabLayout, to file: String = tabLayoutFile) {
    let dir = (file as NSString).deletingLastPathComponent
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    guard let data = try? JSONEncoder().encode(layout) else { return }
    try? (String(decoding: data, as: UTF8.self) + "\n").write(toFile: file, atomically: true, encoding: .utf8)
    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file)
}

/// The tabs worth bringing back: folders that still exist, at most `maxRestoredTabs`. The
/// active index follows its tab by identity — once a folder is gone, the saved index points one
/// slot too far — and lands on the first tab when it points nowhere.
public func restorableTabs(_ layout: TabLayout,
                           exists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) })
    -> (tabs: [SavedTab], activeIndex: Int) {
    let kept = Array(layout.tabs.filter { exists($0.cwd) }.prefix(maxRestoredTabs))
    let wanted = layout.tabs.indices.contains(layout.activeIndex) ? layout.tabs[layout.activeIndex] : nil
    let active = wanted.flatMap { tab in kept.firstIndex(of: tab) } ?? 0
    return (kept, active)
}
