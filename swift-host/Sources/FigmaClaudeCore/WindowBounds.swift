import Foundation

/// Where the window was last time. Port of `app/src/lib/window-bounds.ts`.
///
/// `clamp` takes the work areas as data rather than asking AppKit, so the "monitor was unplugged"
/// case can be exercised without a screen.
public struct Bounds: Codable, Equatable {
    public var x: Double?
    public var y: Double?
    public var width: Double
    public var height: Double

    public init(x: Double? = nil, y: Double? = nil, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public struct WorkArea: Equatable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public let boundsFile = NSHomeDirectory() + "/.figma-ds-cli/panel-window.json"
public let defaultBounds = Bounds(width: 480, height: 720)

private let minWidth: Double = 320
private let minHeight: Double = 240

public func loadBounds(from file: String = boundsFile) -> Bounds {
    guard let data = FileManager.default.contents(atPath: file),
          let bounds = try? JSONDecoder().decode(Bounds.self, from: data)
    else { return defaultBounds }
    return bounds
}

public func saveBounds(_ bounds: Bounds, to file: String = boundsFile) {
    // A window position is not worth an error dialog.
    try? FileManager.default.createDirectory(
        atPath: (file as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
    guard let data = try? JSONEncoder().encode(bounds) else { return }
    try? (String(decoding: data, as: UTF8.self) + "\n").write(toFile: file, atomically: true, encoding: .utf8)
}

/// Keeps a remembered window reachable. A panel parked on a monitor that is no longer attached
/// would otherwise open off-screen — visible in the window list, unreachable with the mouse, and
/// indistinguishable from a crash.
public func clampBounds(_ bounds: Bounds, workAreas: [WorkArea]) -> Bounds {
    let width = max(minWidth, bounds.width.rounded())
    let height = max(minHeight, bounds.height.rounded())

    guard let x = bounds.x, let y = bounds.y, !workAreas.isEmpty else {
        return Bounds(width: width, height: height)
    }

    let visible = workAreas.contains { area in
        let right = min(x + width, area.x + area.width)
        let bottom = min(y + height, area.y + area.height)
        let overlapX = right - max(x, area.x)
        let overlapY = bottom - max(y, area.y)
        // A sliver is not enough: the title bar has to be grabbable.
        return overlapX >= 80 && overlapY >= 40
    }

    if visible {
        return Bounds(x: x.rounded(), y: y.rounded(), width: width, height: height)
    }

    let primary = workAreas[0]
    return Bounds(
        x: (primary.x + max(0, primary.width - width)).rounded(),
        y: primary.y.rounded(),
        width: width,
        height: min(height, primary.height))
}
