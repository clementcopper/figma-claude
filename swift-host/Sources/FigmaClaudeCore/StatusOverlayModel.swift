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

/// Whether a finished message clears itself. A success with nothing to act on is a nudge and
/// disappears; a failure, or anything carrying an action button (e.g. "Open System Settings"),
/// stays until the person dismisses or acts on it.
public func overlayAutoDismisses(ok: Bool, hasAction: Bool) -> Bool {
    ok && !hasAction
}
