import Foundation

/// The Figma files that are open right now, so the menu can point the daemon at one of them.
///
/// The Electron host shells out to `figma-cli files` for this (`app/src/host/figmaActions.ts:126`).
/// That command is a five-line wrapper around one HTTP request — `GET /json` on the debug port,
/// filtered to design and board URLs (`src/commands/figjam.js:446`, `src/figma-client.js:333`) —
/// and a Node start costs more than the request does. A menu is built while the user waits for it
/// to appear, so this asks the port directly and answers in milliseconds.

/// The debug port, `FIGMA_PORT` first — `getCdpPort()` in `src/figma-patch.js` reads the same
/// variable, and hardcoding 9222 is what the project's own notes warn against.
public let cdpPort = Int(ProcessInfo.processInfo.environment["FIGMA_PORT"] ?? "") ?? 9222

public struct OpenFile: Equatable {
    public var title: String
    public var id: String

    public init(title: String, id: String) {
        self.title = title
        self.id = id
    }
}

/// Reads CDP's target list. Only design and board tabs count: the same list carries Figma's own
/// blobs, the feed and the webpack targets, and none of those is a file anyone can bind to.
public func parseOpenFiles(_ data: Data?) -> [OpenFile] {
    guard let data,
          let targets = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return [] }

    return targets.compactMap { target -> OpenFile? in
        guard let url = target["url"] as? String, url.contains("figma.com"),
              url.contains("/design/") || url.contains("/board/") else { return nil }
        // The suffix Figma appends to every tab title; `cleanFileName` is the rule the session
        // name already uses, so a file is called the same thing everywhere in the panel.
        let title = cleanFileName(target["title"] as? String)
        guard !title.isEmpty else { return nil }
        return OpenFile(title: title, id: target["id"] as? String ?? "")
    }
}

/// One request against the debug port. A dead port means "no files", never an error: in Safe Mode
/// there is no port at all and the panel still works.
public func listOpenFiles(port: Int = cdpPort, timeout: TimeInterval = 1.5) -> [OpenFile] {
    guard let url = URL(string: "http://127.0.0.1:\(port)/json") else { return [] }
    var request = URLRequest(url: url, timeoutInterval: timeout)
    request.httpMethod = "GET"

    var payload: Data?
    let done = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: request) { data, response, _ in
        if (response as? HTTPURLResponse)?.statusCode == 200 { payload = data }
        done.signal()
    }.resume()
    _ = done.wait(timeout: .now() + timeout + 0.5)
    return parseOpenFiles(payload)
}

/// Which of the open files the daemon is bound to. `figmaFile` in `panel.json` is a fragment the
/// user typed, so it matches loosely; without one the file the daemon reports is the bound one.
/// Port of the `bound` expression in `app/src/main.ts:528`.
public func boundFile(_ file: OpenFile, configured: String, snapshotFile: String) -> Bool {
    let pin = configured.trimmingCharacters(in: .whitespaces).lowercased()
    if pin.isEmpty { return file.title == snapshotFile }
    return file.title.lowercased().contains(pin)
}
