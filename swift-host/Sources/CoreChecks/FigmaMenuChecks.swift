import Foundation
import FigmaClaudeCore

/// The menu below the status rows: which sections exist, what can be clicked, where the mark sits.
/// No AppKit involved — the rules are the value `figmaMenuSections` returns.
enum FigmaMenuTests {
    static func run() {
        sections()
        enabling()
        markers()
        openFiles()
        configWriter()
        connectFlags()
    }

    private static func titles(_ sections: [MenuSection], _ heading: String) -> [String] {
        sections.first { $0.heading == heading }?.items.map(\.title) ?? []
    }

    private static func item(_ sections: [MenuSection], _ heading: String,
                             _ index: Int) -> MenuItem? {
        let items = sections.first { $0.heading == heading }?.items ?? []
        return index < items.count ? items[index] : nil
    }

    static func sections() {
        let connected = figmaMenuSections(FigmaMenuInput(figma: .ok, cwd: "/tmp/project"))
        Checks.expect(connected.map(\.heading),
                      ["Connection", "Canvas", "Working directory", "Mode", "Appearance"])

        // One open file is not a choice, so the section stays away.
        let one = figmaMenuSections(FigmaMenuInput(figma: .ok, files: [OpenFile(title: "A", id: "1")]))
        Checks.expect(one.map(\.heading).contains("Bound file"), false)

        let two = figmaMenuSections(FigmaMenuInput(
            figma: .ok, files: [OpenFile(title: "A", id: "1"), OpenFile(title: "B", id: "2")]))
        Checks.expect(two.map(\.heading).first, "Bound file")
        Checks.expect(titles(two, "Bound file"), ["A", "B"])

        Checks.expect(titles(connected, "Connection"), ["Connect", "Restart daemon", "Stop daemon"])
        Checks.expect(titles(connected, "Appearance"),
                      ["System — follow macOS", "Light", "Dark"])
        Checks.expect(titles(connected, "Mode"),
                      ["Yolo — patched app, CDP", "Safe — plugin, no patching",
                       "Browser — Chromium profile"])
    }

    static func enabling() {
        // Connect asks whether the way to Figma is missing, not whether the daemon is up.
        //
        // The case that was wrong: `Stop daemon` left Figma running with its port open, and the
        // menu offered `Connect` — the one command that can quit a running Figma — where
        // `Restart daemon` was the answer.
        let daemonStopped = FigmaMenuInput(figma: .off, figmaRunning: true, cdpOk: true)
        Checks.expect(item(figmaMenuSections(daemonStopped), "Connection", 0)?.enabled, false)
        Checks.expect(item(figmaMenuSections(daemonStopped), "Connection", 1)?.enabled, true)

        let connected = FigmaMenuInput(figma: .ok, figmaRunning: true, cdpOk: true)
        Checks.expect(item(figmaMenuSections(connected), "Connection", 0)?.enabled, false)

        // The port is what `connect` restores, so a dead one frees it — as does a closed Figma.
        Checks.expect(connectNeeded(mode: .yolo, figmaRunning: true, cdpOk: false,
                                    daemonSaysConnected: true), true)
        Checks.expect(connectNeeded(mode: .yolo, figmaRunning: false, cdpOk: false,
                                    daemonSaysConnected: false), true)
        Checks.expect(connectNeeded(mode: .yolo, figmaRunning: true, cdpOk: true,
                                    daemonSaysConnected: false), false)
        Checks.expect(connectNeeded(mode: .browser, figmaRunning: true, cdpOk: true,
                                    daemonSaysConnected: false), false)

        // Safe Mode has no port to look at: the daemon's answer is the only one there is.
        Checks.expect(connectNeeded(mode: .safe, figmaRunning: true, cdpOk: true,
                                    daemonSaysConnected: false), true)
        Checks.expect(connectNeeded(mode: .safe, figmaRunning: false, cdpOk: false,
                                    daemonSaysConnected: true), false)
        Checks.expect(item(figmaMenuSections(FigmaMenuInput(figma: .off, mode: .safe)),
                           "Connection", 0)?.enabled, true)

        // No CLI: every action that shells out is dead, and the note says why.
        let noCli = figmaMenuSections(FigmaMenuInput(figma: .off, cliFound: false))
        Checks.expect(item(noCli, "Connection", 0)?.enabled, false)
        Checks.expect(item(noCli, "Connection", 1)?.enabled, false)
        Checks.expect(missingCliNote(cliFound: true), nil)
        Checks.expect(missingCliNote(cliFound: false)?.hasPrefix("figma-cli not found"), true)

        // One action at a time.
        let busy = figmaMenuSections(FigmaMenuInput(figma: .off, mode: .safe, busy: true))
        Checks.expect(item(busy, "Connection", 0)?.title, "Working…")
        Checks.expect(item(busy, "Connection", 0)?.enabled, false)
        Checks.expect(item(busy, "Mode", 0)?.enabled, false)
        // Appearance is the panel's own window, not the CLI's — it never waits on anything.
        Checks.expect(item(busy, "Appearance", 0)?.enabled, true)

        // Undo names its count and is dead without one.
        let nothing = figmaMenuSections(FigmaMenuInput(figma: .ok))
        Checks.expect(item(nothing, "Canvas", 0)?.title, "Nothing to undo")
        Checks.expect(item(nothing, "Canvas", 0)?.enabled, false)
        let undo = figmaMenuSections(FigmaMenuInput(
            figma: .ok, undoNodes: [CreatedNode(id: "1:2", name: "Card")]))
        Checks.expect(item(undo, "Canvas", 0)?.title, "Undo last render (Card)")
        Checks.expect(item(undo, "Canvas", 0)?.enabled, true)

        // The rules are either there or they are not; there is nothing to run twice.
        let ready = figmaMenuSections(FigmaMenuInput(figma: .ok, cwd: "/tmp/p", agentsReady: true))
        Checks.expect(item(ready, "Working directory", 0)?.title, "Rules up to date")
        Checks.expect(item(ready, "Working directory", 0)?.enabled, false)
        let fresh = figmaMenuSections(FigmaMenuInput(figma: .ok, cwd: "/tmp/p"))
        Checks.expect(item(fresh, "Working directory", 0)?.title, "Prepare this folder")
        Checks.expect(item(fresh, "Working directory", 0)?.enabled, true)
        // Without a folder there is nowhere to write them.
        Checks.expect(item(figmaMenuSections(FigmaMenuInput(figma: .ok)), "Working directory", 0)?.enabled,
                      false)
        Checks.expect(item(figmaMenuSections(FigmaMenuInput(figma: .ok)), "Working directory", 1)?.title,
                      "no folder chosen yet")
    }

    static func markers() {
        let sections = figmaMenuSections(FigmaMenuInput(figma: .ok, mode: .browser, theme: .dark))
        // One language for "this is selected" in the whole menu — the system's tick.
        Checks.expect(sections.first { $0.heading == "Mode" }?.items.map(\.marker),
                      [.none, .none, .check])
        Checks.expect(sections.first { $0.heading == "Appearance" }?.items.map(\.marker),
                      [.none, .none, .check])
        Checks.expect(item(sections, "Mode", 2)?.action, .setMode(.browser))
        Checks.expect(item(sections, "Appearance", 1)?.action, .setTheme(.light))

        // The bound file is the one the daemon reports, until panel.json names a fragment.
        let files = [OpenFile(title: "Designdone", id: "1"), OpenFile(title: "Playground", id: "2")]
        let bySnapshot = figmaMenuSections(FigmaMenuInput(figma: .ok, files: files,
                                                          snapshotFile: "Playground"))
        Checks.expect(bySnapshot.first { $0.heading == "Bound file" }?.items.map(\.marker),
                      [.none, .check])
        let byConfig = figmaMenuSections(FigmaMenuInput(figma: .ok, files: files,
                                                        configuredFile: "design",
                                                        snapshotFile: "Playground"))
        Checks.expect(byConfig.first { $0.heading == "Bound file" }?.items.map(\.marker),
                      [.check, .none])
        Checks.expect(item(byConfig, "Bound file", 0)?.action, .bindFile("Designdone"))
    }

    static func openFiles() {
        let json = """
        [{"title":"Designdone – Figma","id":"A","url":"https://www.figma.com/design/abc/Designdone"},
         {"title":"Board – Figma","id":"B","url":"https://www.figma.com/board/def/Board"},
         {"title":"Home – Figma","id":"C","url":"https://www.figma.com/files/recent"},
         {"title":"webpack","id":"D","url":"webpack://main"},
         {"title":"","id":"E","url":"https://www.figma.com/design/ghi/"}]
        """
        let files = parseOpenFiles(json.data(using: .utf8))
        // Design and board tabs only, the " – Figma" suffix off, an unnamed one dropped.
        Checks.expect(files.map(\.title), ["Designdone", "Board"])
        Checks.expect(files.map(\.id), ["A", "B"])

        // Nothing on the port, or something that is not a target list, means "no files".
        Checks.expect(parseOpenFiles(nil).count, 0)
        Checks.expect(parseOpenFiles("not json".data(using: .utf8)).count, 0)
        Checks.expect(parseOpenFiles("{}".data(using: .utf8)).count, 0)

        // The fragment matches loosely and case-insensitively; without one the daemon decides.
        let file = OpenFile(title: "Designdone", id: "A")
        Checks.expect(boundFile(file, configured: "DESIGN", snapshotFile: ""), true)
        Checks.expect(boundFile(file, configured: "  ", snapshotFile: "Designdone"), true)
        Checks.expect(boundFile(file, configured: "  ", snapshotFile: "Other"), false)
    }

    static func configWriter() {
        let directory = NSTemporaryDirectory() + "figma-claude-checks-\(UUID().uuidString)"
        try? FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: directory) }
        let path = directory + "/panel.json"

        // A file the panel has never seen is created rather than refused.
        Checks.expect(updatePanelConfig(["theme": "dark"], path: path), true)
        Checks.expect(PanelConfig.load(from: path).theme, "dark")

        // Keys this host knows nothing about — the Electron one writes several — survive.
        try? #"{"cwd":"/tmp","zoom":1.5,"autoRun":true,"theme":"system"}"#
            .write(toFile: path, atomically: true, encoding: .utf8)
        Checks.expect(updatePanelConfig(["theme": "light", "figmaMode": "safe"], path: path), true)
        let raw = (try? String(contentsOfFile: path, encoding: .utf8)) ?? ""
        let object = (try? JSONSerialization.jsonObject(
            with: raw.data(using: .utf8) ?? Data())) as? [String: Any] ?? [:]
        Checks.expect(object["zoom"] as? Double, 1.5)
        Checks.expect(object["autoRun"] as? Bool, true)
        Checks.expect(object["cwd"] as? String, "/tmp")
        Checks.expect(object["theme"] as? String, "light")
        Checks.expect(object["figmaMode"] as? String, "safe")

        // A config written before this host knew a key still loads — a failed decode would fall
        // back to the defaults and silently move the user's working directory.
        try? #"{"cwd":"/tmp/older","theme":"dark"}"#
            .write(toFile: path, atomically: true, encoding: .utf8)
        let older = PanelConfig.load(from: path)
        Checks.expect(older.cwd, "/tmp/older")
        Checks.expect(older.theme, "dark")
        Checks.expect(older.figmaMode, "yolo")
        Checks.expect(older.command, "claude")

        // A file that does not parse is the user's to fix — it is never overwritten.
        try? "{ this is not json".write(toFile: path, atomically: true, encoding: .utf8)
        Checks.expect(updatePanelConfig(["theme": "dark"], path: path), false)
        Checks.expect((try? String(contentsOfFile: path, encoding: .utf8)), "{ this is not json")
    }

    static func connectFlags() {
        Checks.expect(connectArguments(mode: .yolo), ["connect"])
        Checks.expect(connectArguments(mode: .safe), ["connect", "--safe"])
        Checks.expect(connectArguments(mode: .browser), ["connect", "--browser"])
        // An unset mode is yolo, the CLI's own default.
        Checks.expect(connectArguments(mode: nil), ["connect"])
        Checks.expect(FigmaMode(rawValue: "safe"), .safe)
        Checks.expect(FigmaMode(rawValue: "nonsense"), nil)
    }
}
