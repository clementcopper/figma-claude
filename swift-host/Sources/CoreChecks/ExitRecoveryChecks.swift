import Foundation
import FigmaClaudeCore

/// Cancelling the session picker used to leave a dead terminal. These are the two reasons it did.
enum ExitRecoveryTests {
    static func run() {
        waitStatus()
        planOrder()
        noCarousel()
        otherCodes()
    }

    /// SwiftTerm passes the raw `waitpid` status through, so the panel printed 256 for an exit of 1.
    static func waitStatus() {
        Checks.expect(exitStatus(waitStatus: 256).code, 1)
        Checks.expect(exitStatus(waitStatus: 256).signal, nil)
        Checks.expect(exitStatus(waitStatus: 0).code, 0)
        Checks.expect(exitStatus(waitStatus: 512).code, 2)
        Checks.expect(exitStatus(waitStatus: 65280).code, 255)

        // Killed rather than exited: SIGKILL is 9. The code is the shell's 128+n convention, and
        // the signal is named separately — reading the low bits as an exit code invents a number.
        Checks.expect(exitStatus(waitStatus: 9).signal, 9)
        Checks.expect(exitStatus(waitStatus: 9).code, 137)

        // The reported bug, end to end: what the tab now prints.
        let decoded = exitStatus(waitStatus: 256).code
        Checks.expect(describePtyExit(code: decoded, msSinceSpawn: 5000, sawOutput: true),
                      "\r\n[Process exited with code 1]\r\n")
        // And the bundle hint, which could never fire while 256 was compared against 1.
        Checks.expect(describePtyExit(code: decoded, msSinceSpawn: 100, sawOutput: false)
                        .contains("reinstalled"), true)
    }

    static func planOrder() {
        var recovery = ExitRecovery()
        recovery.register(resumeRecoveryPlan(), for: "tab-1")

        // First cancel: back into the directory's newest session, which is the one that was running.
        let first = recovery.next(for: "tab-1", exitCode: 1)
        Checks.expect(first?.args, ["--continue"])
        Checks.expect(first?.note.contains("Resume cancelled"), true)

        // `--continue` fails the same way in a directory with no session yet — then a plain start.
        let second = recovery.next(for: "tab-1", exitCode: 1)
        Checks.expect(second?.args, [])
        Checks.expect(second?.note.contains("starting a new one"), true)
    }

    /// The property the whole type exists for.
    static func noCarousel() {
        var recovery = ExitRecovery()
        recovery.register(resumeRecoveryPlan(), for: "tab-1")

        var starts = 0
        for _ in 0..<5 where recovery.next(for: "tab-1", exitCode: 1) != nil { starts += 1 }
        Checks.expect(starts, 2)
        Checks.expect(recovery.hasPlan(for: "tab-1"), false)

        // A tab that never asked for a resume falls back on nothing.
        Checks.expect(recovery.next(for: "tab-unknown", exitCode: 1) == nil, true)
    }

    static func otherCodes() {
        var recovery = ExitRecovery()
        recovery.register(resumeRecoveryPlan(), for: "tab-1")

        // A clean exit is not a failure to recover from, and must not spend a step.
        Checks.expect(recovery.next(for: "tab-1", exitCode: 0) == nil, true)
        Checks.expect(recovery.next(for: "tab-1", exitCode: 137) == nil, true)
        Checks.expect(recovery.hasPlan(for: "tab-1"), true)
        Checks.expect(recovery.next(for: "tab-1", exitCode: 1)?.args, ["--continue"])

        // Continue and Restart clear it: there is nothing to catch there.
        recovery.clear(for: "tab-1")
        Checks.expect(recovery.next(for: "tab-1", exitCode: 1) == nil, true)
    }
}
