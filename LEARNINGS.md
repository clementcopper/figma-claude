# LEARNINGS

Project-specific learnings, dead ends, and decisions. Appended by Claude instances after a workload — only when something is genuinely worth remembering. Keep `CLAUDE.md` under 200 lines by putting detail here instead.

Bug-level detail with symptom/cause/fix lives in `.claude/bugs-and-fixes.md`; Plugin API notes in `.claude/figma-plugin-api.md`.

## Figma Plugin API

- Fills and strokes are **immutable arrays** — clone, modify, reassign. In-place mutation is silently ignored.
- `setBoundVariableForPaint(paint, 'color', variable)` returns a *new* paint object. Assigning it back to `fills` is required.
- `createComponentFromNode()` throws if the node already sits inside a Component, ComponentSet, or Instance.
- `layoutWrap = 'WRAP'` only works on HORIZONTAL auto-layout; on VERTICAL it throws.
- STRETCH + AUTO conflict: an auto-layout child with `layoutAlign = 'STRETCH'` needs FIXED sizing on that axis.
- Setting `layoutMode = 'NONE'` does not restore children's original positions — it is a one-way trip.
- Component property names carry a `#uniqueId` suffix (`ButtonText#0:1`); never match on the bare name.
- `frame.isSlot = true` via `eval` does nothing. Only `slot convert` produces a real slot.

## Code Structure

- The two render paths (`parseJSXBatch` vs `parseJSX` + `generateCode`) drift apart easily. Several past bugs — the gray-fallback variable lookup, the HUG-vs-FIXED height default — had to be fixed twice, once per path. When fixing either, check the other.
- Platform branching belongs in `src/platform.js` only. `figma-patch.js` delegates to it; adding a second `process.platform` switch elsewhere is how the two drifted before they were consolidated (9692b7f).
- The daemon hot-reloads `figma-client.js`, so `daemon restart` is enough after client edits — no Figma restart needed. Editing `daemon.js` itself does need the restart.

## Dead Ends

- **`figma-use` as the transport.** Broken on Node 20+, hardcodes port 9222, and fails outright on FigJam (hence `figjam-client.js`). Superseded by the own CDP client. Do not reintroduce.
- **`layoutGrow` for `grow={1}`.** Deprecated and unreliable; map to `layoutSizingHorizontal/Vertical = 'FILL'` on the parent's flex axis instead.
- **`render-batch` for text in Safe Mode.** Text does not render properly through the plugin path. Use `eval` with the native API for text-bearing components there.
- **Default padding on nested frames.** A 16/10 default was intended for buttons but hit every nested frame and made components look broken. Defaults are 0/0 on purpose.
