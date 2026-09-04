import Foundation

/// Reads a child's output to the end, or kills it when the time is up.
///
/// `readDataToEndOfFile` returns when every writer has closed the pipe, and `waitUntilExit`
/// after that is what the callers always did — with a `timeout` parameter that nothing read.
/// So a `figma-cli connect` that hung held `figmaBusy` for the life of the window, and a `.zshrc`
/// waiting for input held `newTab()` on the main thread. This is the one place the deadline is
/// enforced: `runCli` and `LoginShellPath.resolve` both come through here.
///
/// SIGTERM goes to the direct child only. The installed `figma-cli` is a shim that `exec`s node,
/// so that is the same process; a grandchild that keeps the pipe open would still hold the read.
///
/// - Returns: what was read, and whether the process was killed for overrunning the deadline.
public func readOutput(_ process: Process, from pipe: Pipe,
                       timeout: TimeInterval) -> (data: Data, timedOut: Bool) {
    let lock = NSLock()
    var timedOut = false
    let deadline = DispatchWorkItem {
        lock.lock(); timedOut = true; lock.unlock()
        if process.isRunning { process.terminate() }
    }
    DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: deadline)

    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    deadline.cancel()

    lock.lock(); defer { lock.unlock() }
    return (data, timedOut)
}
