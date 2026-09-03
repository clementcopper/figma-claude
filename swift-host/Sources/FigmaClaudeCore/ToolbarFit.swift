import Foundation

/// How the top bar gives way when the window gets narrow.
///
/// The rule, in one place and checkable: the buttons keep their positions — the folder button hangs
/// on the left edge, the three icon buttons on the right — and what adapts is the text inside them.
/// The Figma name goes first, because the three lights beside it already carry the state and the
/// file name is the extra. The folder name then narrows, but it is **never dropped**: it is the
/// only thing in the row that says *where* you are, and the icon beside it does not. It reaches
/// zero only when the arithmetic leaves nothing, which is no longer a decision.

/// Below this the **Figma** label is not worth showing: an ellipsis with a letter in front of it
/// says less than the icon it would be crowding. The folder name has no such floor — see above.
public let minimumLabelWidth: Double = 30

public struct LabelBudgets: Equatable {
    /// Width each label may use. Zero means the label is dropped entirely.
    public var cwd: Double
    public var figma: Double

    public init(cwd: Double, figma: Double) {
        self.cwd = cwd
        self.figma = figma
    }
}

/// - Parameters:
///   - available: what is left once the symbols, the gaps between the buttons and the row's insets
///     have taken theirs. May be negative, which simply means there is nothing to hand out.
///   - cwdGap/figmaGap: the space a label costs *besides* its own width — the gap between the
///     symbols and the text. A label that is dropped gives its gap back, which is why they are
///     part of the arithmetic rather than subtracted by the caller.
public func toolbarLabelBudgets(available: Double, cwdWanted: Double, figmaWanted: Double,
                                cwdGap: Double = 0, figmaGap: Double = 0,
                                minimum: Double = minimumLabelWidth) -> LabelBudgets {
    let free = max(0, available)

    if free >= cwdWanted + cwdGap + figmaWanted + figmaGap {
        return LabelBudgets(cwd: cwdWanted, figma: figmaWanted)
    }

    // The Figma name gives way first: the three lights beside it already say what the state is.
    let forFigma = free - cwdWanted - cwdGap - figmaGap
    if forFigma >= minimum {
        return LabelBudgets(cwd: cwdWanted, figma: min(figmaWanted, forFigma))
    }

    // The Figma label is dropped entirely and its gap comes back to the folder name, which then
    // takes whatever is left. No floor here: squeezed is still an answer to "where am I", gone is
    // not.
    let forCwd = free - cwdGap
    return LabelBudgets(cwd: max(0, min(cwdWanted, forCwd)), figma: 0)
}
