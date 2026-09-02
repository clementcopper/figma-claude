import Foundation

/// What to start instead when a tab's process exits with code 1.
///
/// `--resume` hands the tab to Claude's session picker, and cancelling that picker with Escape
/// ends the process. By then the session the tab was running is already gone — the resume killed
/// it to make room for the picker — and the panel was left showing a dead terminal.
///
/// There is no session id anywhere to go back to. Continuity lives in the CLI's own history,
/// which is per working directory, so the way back is `--continue`: the newest session of that
/// directory, which is the one that was running. `--continue` fails with a code 1 of its own when
/// the directory has no session yet, so a plain start stands behind it.
///
/// Ported from `exitRecovery` in the Electron host's `ClaudeTerminalViewProvider`.
public struct RecoveryStep: Equatable {
    public let args: [String]
    /// Printed into the terminal before the replacement starts, so the restart is explained
    /// rather than merely happening.
    public let note: String

    public init(args: [String], note: String) {
        self.args = args
        self.note = note
    }
}

/// The plan for a tab handed to the session picker.
public func resumeRecoveryPlan() -> [RecoveryStep] {
    [
        RecoveryStep(args: ["--continue"], note: "[Resume cancelled — reopening the tab's last session]"),
        RecoveryStep(args: [], note: "[No session to return to — starting a new one]")
    ]
}

/// Holds one plan per tab and hands out its steps.
///
/// Every step is consumed exactly once. Without that this turns into a restart carousel: the
/// replacement can fail the same way, and a plan that refilled itself would spawn for ever. When
/// a plan runs out, the familiar exit line stands again.
public struct ExitRecovery {
    private var plans: [String: [RecoveryStep]] = [:]

    public init() {}

    public mutating func register(_ plan: [RecoveryStep], for tabId: String) {
        plans[tabId] = plan
    }

    public mutating func clear(for tabId: String) {
        plans.removeValue(forKey: tabId)
    }

    /// The next step for a tab, or nil when there is none — including for any exit code other
    /// than 1, which consumes nothing: a clean exit is not a failure to recover from.
    public mutating func next(for tabId: String, exitCode: Int32) -> RecoveryStep? {
        guard exitCode == 1, var plan = plans[tabId], !plan.isEmpty else { return nil }
        let step = plan.removeFirst()
        if plan.isEmpty {
            plans.removeValue(forKey: tabId)
        } else {
            plans[tabId] = plan
        }
        return step
    }

    /// Whether a tab still has something to fall back on. For tests and for the probe.
    public func hasPlan(for tabId: String) -> Bool { plans[tabId]?.isEmpty == false }
}
