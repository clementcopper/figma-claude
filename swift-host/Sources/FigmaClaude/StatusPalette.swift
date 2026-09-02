import AppKit
import FigmaClaudeCore

/// The status bar's colours, as measured in the Figma file rather than approximated with system
/// colours.
///
/// The bar used `.systemBlue` / `.systemYellow` / `.systemRed`, which track the user's accent and
/// therefore never matched the design in either mode. Every value here was read out of Section
/// `936:2` — light and dark are two separate measurements, not one palette lightened.
///
/// `NSColor(name:dynamicProvider:)` resolves per appearance, so a single constant is correct in
/// both modes and the probe renders whichever one it was asked for.
enum StatusPalette {
    static let ground = dynamic(light: 0xf8f8f8, dark: 0x181818)
    static let separator = dynamic(light: 0xe5e5e5, dark: 0x2b2b2b)
    static let ringTrack = dynamic(light: 0xc8c8c8, dark: 0x454545)
    /// The stop disc and the effort chip share one tone in both modes.
    static let disc = dynamic(light: 0xe4e4e4, dark: 0x2d2e2e)
    static let text = dynamic(light: 0x3b3b3b, dark: 0xcccccc)
    static let subtleText = dynamic(light: 0x6b6b6b, dark: 0x9d9d9d)

    /// The fill is the one colour that differs between modes on purpose — the dark mode indigo is
    /// lifted so it keeps its distance from the darker track.
    static let fill = dynamic(light: 0x5757ff, dark: 0x7878ff)
    /// Warn and danger are identical in both modes; the design fixes them rather than adapting.
    static let warn = solid(0xfda400)
    static let danger = solid(0xec1500)

    static func color(for level: StatusLevel) -> NSColor {
        switch level {
        case .normal: return fill
        case .warn: return warn
        case .danger: return danger
        }
    }

    private static func dynamic(light: Int, dark: Int) -> NSColor {
        NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return rgb(isDark ? dark : light)
        }
    }

    private static func solid(_ hex: Int) -> NSColor { rgb(hex) }

    private static func rgb(_ hex: Int) -> NSColor {
        NSColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255,
                green: CGFloat((hex >> 8) & 0xff) / 255,
                blue: CGFloat(hex & 0xff) / 255,
                alpha: 1)
    }

    /// The design's typeface, not the system's.
    ///
    /// The bar was drawn in **SF Compact Display**, which runs narrower than the SF Pro that
    /// `NSFont.systemFont` hands out. That is not a matter of taste here: at SF Pro the five
    /// status items measured 386pt against the design's 382, which is enough to make the row wrap
    /// at 400pt where the design keeps it on one line. Four points decided a break step.
    ///
    /// Falls back to the system font if the family is ever missing, because a bar in the wrong
    /// typeface still reads and a bar in Times New Roman — which is what CoreText substitutes for
    /// a bad name — does not.
    static func font(size: CGFloat, weight: NSFont.Weight = .regular) -> NSFont {
        let descriptor = NSFontDescriptor(fontAttributes: [
            .family: "SF Compact Display",
            .traits: [NSFontDescriptor.TraitKey.weight: weight]
        ])
        return NSFont(descriptor: descriptor, size: size) ?? .systemFont(ofSize: size, weight: weight)
    }
}
