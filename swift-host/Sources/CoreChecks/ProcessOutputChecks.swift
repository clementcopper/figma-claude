import Foundation
import FigmaClaudeCore

enum ProcessOutputTests {
    private static func spawn(_ path: String, _ arguments: [String]) -> (Process, Pipe) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try! process.run()
        return (process, pipe)
    }

    static func run() {
        // testReadsEverythingAChildPrints
        do {
            let (process, pipe) = spawn("/bin/echo", ["hi"])
            let result = readOutput(process, from: pipe, timeout: 5)
            Checks.expect(String(decoding: result.data, as: UTF8.self), "hi\n")
            Checks.expect(result.timedOut, false)
            Checks.expect(process.terminationStatus, 0)
        }

        // testKillsAChildThatOverrunsTheDeadline
        do {
            let started = Date()
            let (process, pipe) = spawn("/bin/sleep", ["5"])
            let result = readOutput(process, from: pipe, timeout: 0.2)
            Checks.expect(result.timedOut, true)
            Checks.expect(Date().timeIntervalSince(started) < 2, true)
            Checks.expect(process.isRunning, false)
        }

        // testRunCliReportsTheTimeoutInWords
        do {
            let cli = CliInvocation(file: "/bin/sleep", args: ["5"], source: .configured)
            let result = runCli(cli, [], timeout: 0.2)
            Checks.expect(result.ok, false)
            Checks.expect(result.output.contains("timed out"), true)
        }
    }
}
