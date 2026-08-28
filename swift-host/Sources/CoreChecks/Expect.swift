import Foundation

/// A three-function test harness, because XCTest needs a full Xcode install and this machine has
/// only the Command Line Tools: `xcrun --show-sdk-platform-path` fails, and `swift test` stops at
/// "error: XCTest not available". Converting these back to XCTest is mechanical once Xcode is
/// there — the case names are kept identical to `app/tests/` so the mapping stays obvious.
enum Checks {
    static var failures: [String] = []
    static var passed = 0

    static func expect<T: Equatable>(_ actual: T, _ expected: T,
                                     file: String = #fileID, line: Int = #line) {
        let label = "\(file):\(line)"
        if actual == expected {
            passed += 1
        } else {
            failures.append("  \(label)\n     got:      \(actual)\n     expected: \(expected)")
        }
    }

    static func expectNil<T>(_ actual: T?, file: String = #fileID, line: Int = #line) {
        let label = "\(file):\(line)"
        if actual == nil { passed += 1 } else {
            failures.append("  \(label)\n     got: \(String(describing: actual!)), expected nil")
        }
    }

    static func report() -> Never {
        for failure in failures { print("FAIL \(failure)") }
        print("\(passed) passed, \(failures.count) failed")
        exit(failures.isEmpty ? 0 : 1)
    }
}
