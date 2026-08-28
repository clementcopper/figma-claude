import Foundation
import FigmaClaudeCore

/// The Electron host had no test for tab ordering — the logic sat in three places in `main.ts`
/// and was only ever exercised by clicking. These are the cases that were implicit there.
enum TabStateTests {
    static func run() {
        naming()
        activation()
        closing()
        cycling()
    }

    static func naming() {
        var state = TabState<String>()
        Checks.expect(state.nextName(), "Claude 1")
        Checks.expect(state.nextName(), "Claude 2")
        // The counter never reuses a number, so two tabs can never both have been "Claude 2".
        _ = state.append("a"); _ = state.append("b")
        state.close(1)
        Checks.expect(state.nextName(), "Claude 3")
    }

    static func activation() {
        var state = TabState<String>()
        Checks.expectNil(state.active)
        Checks.expect(state.count, 0)

        state.append("a")
        Checks.expect(state.active, "a")
        state.append("b")
        // A new tab takes the front — that is what opening one is for.
        Checks.expect(state.active, "b")

        state.activate(0)
        Checks.expect(state.active, "a")
        // Out of range is ignored rather than clearing the selection.
        state.activate(9)
        Checks.expect(state.active, "a")
    }

    static func closing() {
        var state = TabState<String>()
        state.append("a"); state.append("b"); state.append("c")

        // Closing the active tab hands over to its right-hand neighbour.
        state.activate(1)
        Checks.expect(state.close(1), "b")
        Checks.expect(state.active, "c")

        // Closing an inactive tab to the left must not move the selection.
        state.append("d")            // a, c, d — active is d
        state.activate(1)            // active is c
        Checks.expect(state.close(0), "a")
        Checks.expect(state.active, "c")

        // Closing the last tab falls back to the new last one.
        state.activate(1)            // c, d — active is d
        Checks.expect(state.close(1), "d")
        Checks.expect(state.active, "c")

        // The final close leaves nothing active rather than an index into an empty array.
        state.close(0)
        Checks.expectNil(state.active)
        Checks.expect(state.count, 0)

        // Out of range changes nothing.
        Checks.expectNil(state.close(3))
    }

    static func cycling() {
        var state = TabState<String>()
        state.append("a"); state.append("b"); state.append("c")
        state.activate(0)

        state.cycle(by: 1)
        Checks.expect(state.active, "b")
        state.cycle(by: -1)
        Checks.expect(state.active, "a")

        // Wraps rather than stopping at the ends.
        state.cycle(by: -1)
        Checks.expect(state.active, "c")
        state.cycle(by: 1)
        Checks.expect(state.active, "a")

        // Nothing to cycle through is not a crash.
        var empty = TabState<String>()
        empty.cycle(by: 1)
        Checks.expectNil(empty.active)
    }
}
