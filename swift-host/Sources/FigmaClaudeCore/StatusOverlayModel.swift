import Foundation

/// Pure decisions behind the status overlay, kept out of the AppKit view so they can be tested.

/// The line the overlay shows while an action runs, from the action's title. The titles come
/// from `runInBackground(title:)` — "Connect", "Restart daemon", and so on.
public func actionProgressText(_ title: String) -> String {
    switch title {
    case "Connect": return "Connecting…"
    case "Restart daemon": return "Restarting daemon…"
    case "Stop daemon": return "Stopping daemon…"
    default: return "\(title)…"
    }
}
