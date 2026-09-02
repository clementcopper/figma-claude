import AppKit
import FigmaClaudeCore

/// Renders the rings on their own, so the geometry can be looked at before a bar is built around
/// it. Arc direction, where the 60° gap sits, whether the caps are round and whether the
/// compaction segments land at 120/227/334 are all things a still image settles and prose does not.
enum RingProbe {
    static func run(to path: String) {
        let specs: [(String, StatusRingView.Mode, StatusLevel, String)] = [
            ("empty", .fill(fraction: 0), .normal, "0%"),
            ("53%", .fill(fraction: 0.53), .normal, "53%"),
            ("full", .fill(fraction: 1), .normal, "100%"),
            ("warn", .fill(fraction: 0.82), .warn, "82%"),
            ("danger", .fill(fraction: 0.95), .danger, "95%"),
            ("comp 0/3", .segments(lit: 0, budget: 3), .normal, "0"),
            ("comp 2/3", .segments(lit: 2, budget: 3), .warn, "2"),
            ("comp 3/3", .segments(lit: 3, budget: 3), .danger, "3"),
            ("comp 1/3", .segments(lit: 1, budget: 3), .normal, "1"),
            // Past the budget: still three segments, all red, and the true count in the middle.
            ("comp 5/3", .segments(lit: 5, budget: 3), .danger, "5")
        ]

        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 16
        row.alignment = .top
        row.edgeInsets = NSEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)

        for (caption, mode, level, value) in specs {
            let column = NSStackView()
            column.orientation = .vertical
            column.spacing = 6
            column.alignment = .centerX

            let ring = StatusRingView(frame: .zero)
            ring.set(mode: mode, level: level, value: value)
            column.addArrangedSubview(ring)

            let label = NSTextField(labelWithString: caption)
            label.font = .systemFont(ofSize: 9)
            label.textColor = StatusPalette.subtleText
            column.addArrangedSubview(label)

            row.addArrangedSubview(column)
        }

        let host = NSView(frame: NSRect(origin: .zero, size: row.fittingSize))
        host.wantsLayer = true
        host.layer?.backgroundColor = StatusPalette.ground.cgColor
        row.frame = host.bounds
        host.addSubview(row)
        host.layoutSubtreeIfNeeded()

        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return }
        host.cacheDisplay(in: host.bounds, to: rep)
        if let data = rep.representation(using: .png, properties: [:]) {
            try? data.write(to: URL(fileURLWithPath: path))
            print("[probe] rings -> \(path) at \(Int(host.bounds.width))×\(Int(host.bounds.height))")
        }
    }

    /// The whole line at the five widths Daniel measured, rendered from a real snapshot through
    /// `statusRings` — the same path the app takes. Rendering hand-built views here would have
    /// checked my arrangement rather than the wiring.
    static func bar(to path: String, widths: [CGFloat] = [500, 400, 320, 220, 170]) {
        var snapshot = StatusLineSnapshot()
        snapshot.model = "Opus 5"
        snapshot.effort = "high"
        snapshot.cwd = "/Users/danielmartin/Documents/DMA/Designdone/Business"
        snapshot.usedTokens = 254_321
        snapshot.totalTokens = 1_000_000
        snapshot.usedPercent = 31.8
        snapshot.sessionPercent = 41
        snapshot.sessionResetsInMin = 130
        snapshot.weekPercent = 12
        snapshot.weekResetsAt = "Sun 1:00 AM"
        snapshot.compacted = 2
        snapshot.compactBudget = 3
        snapshot.updatedAt = Date().timeIntervalSince1970

        let column = NSStackView()
        column.orientation = .vertical
        column.spacing = 14
        column.alignment = .leading
        column.edgeInsets = NSEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)

        for width in widths {
            let caption = NSTextField(labelWithString: "\(Int(width)) pt")
            caption.font = .systemFont(ofSize: 9)
            caption.textColor = StatusPalette.subtleText
            column.addArrangedSubview(caption)

            let line = StatusRingLineView(frame: .zero)
            // The view switches this off for its own constraints; the probe hands it a frame, so
            // it has to own that frame again. Without this Auto Layout discarded every size set
            // here and the row rendered as a single group — while the measurements, taken before
            // the discard, still reported the right one.
            line.translatesAutoresizingMaskIntoConstraints = true
            line.render(snapshot)
            // The pointer state on the one control that has one, so a still image still shows it.
            if width == widths.first { line.previewStopHover() }

            line.frame = NSRect(x: 0, y: 0, width: width, height: line.intrinsicContentSize.height)
            line.layoutSubtreeIfNeeded()
            line.frame = NSRect(x: 0, y: 0, width: width, height: line.intrinsicContentSize.height)
            line.layoutSubtreeIfNeeded()

            let box = NSView(frame: line.bounds)
            box.addSubview(line)
            box.translatesAutoresizingMaskIntoConstraints = false
            box.widthAnchor.constraint(equalToConstant: width).isActive = true
            box.heightAnchor.constraint(equalToConstant: line.bounds.height).isActive = true
            column.addArrangedSubview(box)

            if width == widths.first { print("[probe] widths \(line.measureItems())") }
            print("[probe] \(Int(width))pt -> \(line.measure())")
        }

        let host = NSView(frame: NSRect(origin: .zero, size: column.fittingSize))
        host.wantsLayer = true
        host.layer?.backgroundColor = StatusPalette.ground.cgColor
        column.frame = host.bounds
        host.addSubview(column)
        host.layoutSubtreeIfNeeded()

        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return }
        host.cacheDisplay(in: host.bounds, to: rep)
        if let data = rep.representation(using: .png, properties: [:]) {
            try? data.write(to: URL(fileURLWithPath: path))
            print("[probe] bar -> \(path) at \(Int(host.bounds.width))×\(Int(host.bounds.height))")
        }
    }
}
