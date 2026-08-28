import Foundation

/// Which tab is which, and which one is in front.
///
/// Port of `app/src/host/terminalStateManager.ts`, minus the machinery that only existed because
/// Electron splits the app in two: there, every tab needs a string id because the renderer owns
/// the views and the host owns the processes, and the two halves can only name things. In one
/// process a tab is the object that holds its own view, so what is left is the ordering and the
/// question the Electron version answered in three places — which tab takes over when one closes.
public struct TabState<Tab>: CustomStringConvertible {
    public private(set) var tabs: [Tab] = []
    public private(set) var activeIndex: Int?
    private var counter = 0

    public init() {}

    public var count: Int { tabs.count }

    public var active: Tab? {
        guard let activeIndex, tabs.indices.contains(activeIndex) else { return nil }
        return tabs[activeIndex]
    }

    /// `Claude 1`, `Claude 2`, … — the counter never reuses a number, so closing the second tab
    /// and opening a new one does not produce two tabs that were both once called `Claude 2`.
    public mutating func nextName() -> String {
        counter += 1
        return "Claude \(counter)"
    }

    @discardableResult
    public mutating func append(_ tab: Tab) -> Int {
        tabs.append(tab)
        activeIndex = tabs.count - 1
        return tabs.count - 1
    }

    /// Swaps a tab for another in place — a respawn keeps its position and its neighbours.
    public mutating func replace(at index: Int, with tab: Tab) {
        guard tabs.indices.contains(index) else { return }
        tabs[index] = tab
    }

    public mutating func activate(_ index: Int) {
        guard tabs.indices.contains(index) else { return }
        activeIndex = index
    }

    /// Removes a tab and says which one is in front afterwards.
    ///
    /// Closing the active tab hands over to its right-hand neighbour, or to the new last tab when
    /// there is none — the order a browser uses, and the one that does not make the window jump
    /// to the far end. Closing an inactive tab must not change which tab is active, which is the
    /// case the index arithmetic gets wrong if it is written twice.
    @discardableResult
    public mutating func close(_ index: Int) -> Tab? {
        guard tabs.indices.contains(index) else { return nil }
        let removed = tabs.remove(at: index)

        guard let current = activeIndex else { return removed }
        if tabs.isEmpty {
            activeIndex = nil
        } else if index == current {
            activeIndex = min(index, tabs.count - 1)
        } else if index < current {
            activeIndex = current - 1
        }
        return removed
    }

    /// ⌃Tab and ⌃⇧Tab: wraps around rather than stopping at the ends.
    public mutating func cycle(by offset: Int) {
        guard !tabs.isEmpty, let current = activeIndex else { return }
        let count = tabs.count
        activeIndex = ((current + offset) % count + count) % count
    }

    public var description: String {
        "TabState(\(tabs.count) tabs, active \(activeIndex.map(String.init) ?? "none"))"
    }
}
