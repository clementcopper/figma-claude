import AppKit
import FigmaClaudeCore

/// One status ring: a 300° track, an arc drawn over it, and the value in the middle.
///
/// The web host gets this from an SVG `<circle>` with a dash offset and a rotation. AppKit has no
/// dash offset to lean on, so the arc is a real path — which is why the angles come from
/// `RingGeometry` and are unit-tested there rather than being worked out here.
///
/// One coordinate detail decides whether the ring is right or mirrored: the design measures
/// degrees clockwise from 3 o'clock, AppKit's `appendArc` counts counterclockwise. Every design
/// angle is therefore negated on the way in, and the arc is drawn with `clockwise: true`.
final class StatusRingView: NSView {
    /// A continuous ring (context, session, week) or a counting one (compaction).
    enum Mode {
        case fill(fraction: Double)
        case segments(lit: Int, budget: Int)
    }

    private var mode: Mode = .fill(fraction: 0)
    private var level: StatusLevel = .normal
    private let valueLabel = NSTextField(labelWithString: "")

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        valueLabel.alignment = .center
        valueLabel.textColor = StatusPalette.text
        valueLabel.translatesAutoresizingMaskIntoConstraints = false
        addSubview(valueLabel)

        translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: RingGeometry.boxSize),
            heightAnchor.constraint(equalToConstant: RingGeometry.boxSize),
            valueLabel.centerXAnchor.constraint(equalTo: centerXAnchor),
            valueLabel.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func set(mode: Mode, level: StatusLevel, value: String) {
        self.mode = mode
        self.level = level
        valueLabel.stringValue = value
        // Four characters ("100%") reach the arc at the design's 10pt, so that one case steps down.
        valueLabel.font = StatusPalette.font(size: value.count > 3 ? 9 : 10, weight: .semibold)
        valueLabel.textColor = level == .normal ? StatusPalette.text : StatusPalette.color(for: level)
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        let center = CGPoint(x: bounds.midX, y: bounds.midY)

        stroke(from: RingGeometry.startDegrees,
               to: RingGeometry.startDegrees + RingGeometry.spanDegrees,
               center: center, color: StatusPalette.ringTrack)

        switch mode {
        case .fill(let fraction):
            // A zero-length arc still paints a round cap — a dot on an empty ring. Skipped.
            guard fraction > 0.001 else { break }
            let arc = RingGeometry.fillArc(fraction: fraction)
            stroke(from: arc.start, to: arc.end, center: center,
                   color: StatusPalette.color(for: level))

        case .segments(let lit, let budget):
            // One level for the whole ring, not one per segment: the ring reports the state the
            // session is in, and a two-tone ring reads as two different measurements.
            let reached = RingGeometry.compactionLevel(compacted: lit)
            let segments = RingGeometry.compactionSegments(budget: budget)
            for (index, segment) in segments.enumerated() where index < lit {
                stroke(from: segment.start, to: segment.end, center: center,
                       color: StatusPalette.color(for: reached))
            }
        }

        super.draw(dirtyRect)
    }

    /// Design degrees (clockwise from 3 o'clock) onto an AppKit arc (counterclockwise).
    private func stroke(from start: CGFloat, to end: CGFloat, center: CGPoint, color: NSColor) {
        let path = NSBezierPath()
        path.appendArc(withCenter: center,
                       radius: RingGeometry.radius,
                       startAngle: -start,
                       endAngle: -end,
                       clockwise: true)
        path.lineWidth = RingGeometry.strokeWidth
        // Round caps are the whole reason the arc is a path and not a wedge — `arcData` on an
        // ellipse cuts the ends flat, which is what the design explicitly does not want.
        path.lineCapStyle = .round
        color.setStroke()
        path.stroke()
    }
}
