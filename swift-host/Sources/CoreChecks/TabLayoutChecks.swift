import Foundation
import FigmaClaudeCore

/// What survives a quit: the tabs, their sessions and which one was in front. The file is the
/// contract between one run and the next, so the cases are the ones a file can get wrong —
/// missing, broken, from another shape of the app, pointing at a folder that is gone.
enum TabLayoutTests {
    static func run() {
        roundTrip()
        unreadable()
        restorable()
        stateRestore()
    }

    static func tempFile() -> String {
        NSTemporaryDirectory() + "fc-tabs-\(UUID().uuidString)/nested/panel-tabs.json"
    }

    static func sample() -> TabLayout {
        TabLayout(tabs: [
            SavedTab(id: "tab-A1B2C3D4", name: "Claude 1", cwd: "/Users/x/p",
                     sessionId: "7f3a1c2d-4b5e-4a6f-8c9d-0e1f2a3b4c5d", sessionName: "fc-x-7f3a"),
            SavedTab(id: "tab-E5F6A7B8", name: "Claude 3", cwd: "/Users/x/q",
                     sessionId: "", sessionName: "")
        ], activeIndex: 1, counter: 3)
    }

    static func roundTrip() {
        let file = tempFile()
        defer { try? FileManager.default.removeItem(atPath: (file as NSString).deletingLastPathComponent) }
        Checks.expectNil(loadTabLayout(from: file))
        saveTabLayout(sample(), to: file)
        let back = loadTabLayout(from: file)
        Checks.expect(back, sample())
        Checks.expect(back?.version, tabLayoutVersion)
        // Mode 600 like panel.json: the file names sessions.
        let mode = (try? FileManager.default.attributesOfItem(atPath: file))?[.posixPermissions] as? Int
        Checks.expect(mode, 0o600)
    }

    static func unreadable() {
        let file = tempFile()
        defer { try? FileManager.default.removeItem(atPath: (file as NSString).deletingLastPathComponent) }
        try? FileManager.default.createDirectory(atPath: (file as NSString).deletingLastPathComponent,
                                                 withIntermediateDirectories: true)
        try? "{not json".write(toFile: file, atomically: true, encoding: .utf8)
        Checks.expectNil(loadTabLayout(from: file))
        // Another shape of the app wrote it: discarded, never guessed at.
        try? #"{"version":99,"tabs":[],"activeIndex":0,"counter":0}"#.write(toFile: file, atomically: true, encoding: .utf8)
        Checks.expectNil(loadTabLayout(from: file))
    }

    static func restorable() {
        let layout = sample()
        let both = restorableTabs(layout, exists: { _ in true })
        Checks.expect(both.tabs.map(\.id), ["tab-A1B2C3D4", "tab-E5F6A7B8"])
        Checks.expect(both.activeIndex, 1)

        // A folder that is gone takes its tab with it; the active index follows the tab, not
        // the slot.
        let onlyFirst = restorableTabs(layout, exists: { $0 == "/Users/x/p" })
        Checks.expect(onlyFirst.tabs.map(\.id), ["tab-A1B2C3D4"])
        Checks.expect(onlyFirst.activeIndex, 0)
        let onlySecond = restorableTabs(layout, exists: { $0 == "/Users/x/q" })
        Checks.expect(onlySecond.tabs.map(\.id), ["tab-E5F6A7B8"])
        Checks.expect(onlySecond.activeIndex, 0)
        Checks.expect(restorableTabs(layout, exists: { _ in false }).tabs.isEmpty, true)

        // An index off the end lands on the first tab rather than nowhere.
        var odd = layout
        odd.activeIndex = 7
        Checks.expect(restorableTabs(odd, exists: { _ in true }).activeIndex, 0)

        // A corrupt file cannot open hundreds: the ceiling is the extension's.
        var many = layout
        many.tabs = (0..<40).map { SavedTab(id: "tab-\($0)", name: "Claude \($0)", cwd: "/x",
                                             sessionId: "", sessionName: "") }
        many.activeIndex = 39
        let capped = restorableTabs(many, exists: { _ in true })
        Checks.expect(capped.tabs.count, maxRestoredTabs)
        Checks.expect(capped.activeIndex, 0)
    }

    /// `TabState` takes a saved set back without the activation cascade `append` has, keeps
    /// the counter, and names the next tab after the highest ever used.
    static func stateRestore() {
        var state = TabState<String>()
        state.restore(["a", "b", "c"], activeIndex: 1, counter: 5)
        Checks.expect(state.tabs, ["a", "b", "c"])
        Checks.expect(state.activeIndex, 1)
        Checks.expect(state.active, "b")
        Checks.expect(state.counter, 5)
        Checks.expect(state.nextName(), "Claude 6")

        // Out of range lands on the first tab; empty restores nothing.
        state.restore(["a"], activeIndex: 4, counter: 0)
        Checks.expect(state.activeIndex, 0)
        state.restore([], activeIndex: 0, counter: 2)
        Checks.expectNil(state.activeIndex)
        Checks.expect(state.counter, 2)
    }
}
