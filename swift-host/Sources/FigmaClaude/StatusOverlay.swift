import AppKit
import FigmaClaudeCore

/// A small non-blocking card over the terminal that reports what an action did.
///
/// Action results (Connect, mode switch, daemon) used to land in the Figma menu button as a toast
/// and were cut off with an ellipsis — and there was no sign of progress while the action ran,
/// which for a Pipe-Mode connect is up to ~20 s. This shows a spinner while the work runs and the
/// full, wrapping text when it finishes. It never becomes first responder, so the terminal
/// underneath stays usable; `PanelContentView.layout()` frames it, top-right of the terminal band.
final class StatusOverlay: NSView {
    private let spinner = NSProgressIndicator()
    private let symbol = NSImageView()
    private let label = NSTextField(wrappingLabelWithString: "")
    private let actionButton = NSButton()
    private let closeButton = NSButton()
    /// The row holding the buttons. Hidden when there are none (begin/info): an empty but visible
    /// stack still claims the parent column's 8 pt spacing, which showed as extra padding below
    /// the text in the spinner state.
    private let buttonsStack = NSStackView()

    private var dismissWork: DispatchWorkItem?
    private var actionHandler: (() -> Void)?

    /// The text wraps rather than growing the card without bound; the card is as wide as this
    /// plus its chrome. Wide enough for a full "Ready! Pipe Mode active — …" on two or three lines.
    private let maxTextWidth: CGFloat = 300

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        isHidden = true

        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isIndeterminate = true
        spinner.isDisplayedWhenStopped = false
        spinner.isHidden = true
        spinner.setContentHuggingPriority(.required, for: .horizontal)

        symbol.isHidden = true
        symbol.setContentHuggingPriority(.required, for: .horizontal)

        label.font = .systemFont(ofSize: 12)
        label.textColor = StatusPalette.text
        label.maximumNumberOfLines = 0
        label.lineBreakMode = .byWordWrapping
        label.preferredMaxLayoutWidth = maxTextWidth
        label.setContentCompressionResistancePriority(.required, for: .vertical)

        styleTextButton(closeButton, title: "Close", action: #selector(closeClicked))
        styleTextButton(actionButton, title: "", action: #selector(actionClicked))
        closeButton.isHidden = true
        actionButton.isHidden = true

        // Spinner and check/cross share one fixed 16×16 slot, both centred in it — so the card's
        // geometry is identical whether it shows the spinner (begin) or the mark (finish), and
        // the leading glyph lines up with the first line of text rather than floating above it.
        let glyph = NSView()
        glyph.translatesAutoresizingMaskIntoConstraints = false
        spinner.translatesAutoresizingMaskIntoConstraints = false
        symbol.translatesAutoresizingMaskIntoConstraints = false
        symbol.imageScaling = .scaleProportionallyUpOrDown
        glyph.addSubview(spinner)
        glyph.addSubview(symbol)
        NSLayoutConstraint.activate([
            glyph.widthAnchor.constraint(equalToConstant: 16),
            glyph.heightAnchor.constraint(equalToConstant: 16),
            spinner.centerXAnchor.constraint(equalTo: glyph.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: glyph.centerYAnchor),
            spinner.widthAnchor.constraint(equalToConstant: 16),
            spinner.heightAnchor.constraint(equalToConstant: 16),
            symbol.centerXAnchor.constraint(equalTo: glyph.centerXAnchor),
            symbol.centerYAnchor.constraint(equalTo: glyph.centerYAnchor),
            symbol.widthAnchor.constraint(equalToConstant: 16),
            symbol.heightAnchor.constraint(equalToConstant: 16),
        ])

        buttonsStack.setViews([actionButton, closeButton], in: .leading)
        buttonsStack.orientation = .horizontal
        buttonsStack.spacing = 8
        buttonsStack.isHidden = true

        let textColumn = NSStackView(views: [label, buttonsStack])
        textColumn.orientation = .vertical
        textColumn.alignment = .leading
        textColumn.spacing = 8

        let row = NSStackView(views: [glyph, textColumn])
        row.orientation = .horizontal
        row.alignment = .top
        row.spacing = 10
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        // One inset all around, so the card's four margins read the same.
        let pad: CGFloat = 14
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: pad),
            row.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -pad),
            row.topAnchor.constraint(equalTo: topAnchor, constant: pad),
            row.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -pad),
            label.widthAnchor.constraint(lessThanOrEqualToConstant: maxTextWidth),
        ])
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    // A card set in init would freeze its appearance; resolve the tokens in updateLayer instead.
    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() {
        layer?.backgroundColor = StatusPalette.ground.cgColor
        layer?.cornerRadius = 10
        layer?.borderWidth = 1
        layer?.borderColor = StatusPalette.separator.cgColor
        layer?.masksToBounds = false
        layer?.shadowColor = NSColor.black.cgColor
        layer?.shadowOpacity = 0.18
        layer?.shadowRadius = 12
        layer?.shadowOffset = CGSize(width: 0, height: -2)
    }

    // MARK: - API

    /// Work started: spinner on, the one-line "Connecting…" text, no buttons.
    func begin(_ text: String) {
        cancelDismiss()
        actionHandler = nil
        symbol.isHidden = true
        spinner.isHidden = false
        spinner.startAnimation(nil)
        actionButton.isHidden = true
        closeButton.isHidden = true
        buttonsStack.isHidden = true
        label.stringValue = text
        present()
    }

    /// A persistent "still connecting" state, refreshed by the poll — the spinner keeps turning
    /// and the text says what is being waited on ("Safe Mode — run the FigCli plugin in Figma",
    /// "Pipe Mode — Figma is loading…") until the connection actually completes. The spinner is
    /// not restarted when it is already turning, so repeated polls do not make it stutter.
    func waiting(_ text: String) {
        cancelDismiss()
        actionHandler = nil
        symbol.isHidden = true
        if spinner.isHidden { spinner.isHidden = false; spinner.startAnimation(nil) }
        actionButton.isHidden = true
        closeButton.isHidden = true
        buttonsStack.isHidden = true
        label.stringValue = text
        present()
    }

    /// Work finished: spinner off, a green ✓ or red ✗, the full text, a Close button, and an
    /// optional action (the App-Management case keeps its "Open System Settings"). It stays until
    /// the person dismisses it — success included, so there is time to read the whole message.
    func finish(ok: Bool, text: String, action: (title: String, handler: () -> Void)? = nil) {
        cancelDismiss()
        spinner.stopAnimation(nil)
        spinner.isHidden = true
        setSymbol(ok: ok)
        symbol.isHidden = false
        label.stringValue = text.isEmpty ? (ok ? "Done" : "Failed") : text
        if let action {
            actionHandler = action.handler
            actionButton.title = action.title
            actionButton.isHidden = false
        } else {
            actionHandler = nil
            actionButton.isHidden = true
        }
        closeButton.isHidden = false
        buttonsStack.isHidden = false
        present()
    }

    /// A brief nudge that is not tied to an action (the context / clear-threshold hints). No
    /// spinner, no buttons, clears itself.
    func info(_ text: String) {
        cancelDismiss()
        actionHandler = nil
        spinner.stopAnimation(nil)
        spinner.isHidden = true
        symbol.isHidden = true
        actionButton.isHidden = true
        closeButton.isHidden = true
        buttonsStack.isHidden = true
        label.stringValue = text
        present()
        scheduleDismiss(after: 3)
    }

    func dismiss() {
        cancelDismiss()
        spinner.stopAnimation(nil)
        isHidden = true
        relayout()
    }

    // MARK: - Internals

    private func present() {
        // No reparenting here — re-adding the view on every message flickered. The card is added
        // last at setup and the terminal band it floats over never draws on top of it.
        isHidden = false
        invalidateIntrinsicContentSize()
        relayout()
    }

    private func relayout() {
        needsLayout = true
        layoutSubtreeIfNeeded()
        // The card's frame is the content view's job; ask it for a fresh pass.
        superview?.needsLayout = true
        superview?.layoutSubtreeIfNeeded()
    }

    private func setSymbol(ok: Bool) {
        let name = ok ? "checkmark.circle.fill" : "xmark.octagon.fill"
        let fallback = ok ? "checkmark.circle" : "xmark.circle"
        let colour = ok ? NSColor.systemGreen : NSColor.systemRed
        let base = symbolImage([name, fallback], pointSize: 15, describing: ok ? "success" : "error").image
        // Hierarchical, not a single palette colour: a flat tint fills the whole `.fill` glyph
        // one colour and knocks the checkmark out to invisible — it read as a plain green disc.
        // Hierarchical keeps the tick/cross legible against the coloured body.
        let config = NSImage.SymbolConfiguration(pointSize: 15, weight: .regular)
            .applying(NSImage.SymbolConfiguration(hierarchicalColor: colour))
        symbol.image = base?.withSymbolConfiguration(config)
    }

    private func styleTextButton(_ button: NSButton, title: String, action: Selector) {
        button.title = title
        button.bezelStyle = .rounded
        button.controlSize = .small
        button.font = .systemFont(ofSize: 11)
        button.target = self
        button.action = action
        button.setContentHuggingPriority(.required, for: .horizontal)
    }

    private func scheduleDismiss(after seconds: TimeInterval) {
        let work = DispatchWorkItem { [weak self] in self?.dismiss() }
        dismissWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    private func cancelDismiss() {
        dismissWork?.cancel()
        dismissWork = nil
    }

    @objc private func closeClicked() { dismiss() }

    @objc private func actionClicked() {
        let handler = actionHandler
        dismiss()
        handler?()
    }
}
