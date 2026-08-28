// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FigmaClaude",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(url: "https://github.com/migueldeicaza/SwiftTerm", from: "1.2.0")
    ],
    targets: [
        // Everything that is pure logic lives here, so it can be tested without a window — the
        // same split the Electron host uses between `src/lib/` and `src/host/`.
        .target(name: "FigmaClaudeCore"),
        .executableTarget(
            name: "FigmaClaude",
            dependencies: ["FigmaClaudeCore", "SwiftTerm"]
        ),
        // XCTest needs a full Xcode; this machine has only the Command Line Tools, so the
        // ported cases run as a plain executable instead. `swift run CoreChecks`.
        .executableTarget(
            name: "CoreChecks",
            dependencies: ["FigmaClaudeCore"]
        )
    ]
)
