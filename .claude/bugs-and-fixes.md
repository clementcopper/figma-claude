# Bugs and Fixes History

## Variable Binding Gray Fallback (f8d519b)
**Symptom**: All components rendered with gray `rgb(128,128,128)` fills
**Cause**: Variable loader searched for `c.name === 'shadcn'` but collections are named `shadcn/primitives` and `shadcn/semantic`
**Fix**: Changed to `c.name.startsWith('shadcn')` and iterate all matching collections
**Location**: Two places in figma-client.js (render-batch ~line 357, single render ~line 1090)

## Content Overflow / Fixed Height (f8d519b)
**Symptom**: Settings Panel content overflows frame, gets clipped
**Cause**: Without explicit `h`, root frame defaults to `h=200` with FIXED sizing
**Fix**: When no explicit height, use `primaryAxisSizingMode = 'AUTO'` (HUG) instead of FIXED. Axis depends on layout direction (VERTICAL: primary=height, HORIZONTAL: primary=width)
**Location**: Two code paths - render-batch and single render with var:

## Self-Closing Frame Parser (3353bbd)
**Symptom**: Floating gray rectangles appearing as siblings instead of nested children
**Cause**: `frameOpenRegex` (`/<Frame...>/`) matched self-closing `<Frame ... />` because `>` at end of `/>` matched
**Fix**:
1. Parse open/close Frame tags FIRST, then self-closing ones outside consumed ranges
2. Skip self-closing in frameOpenRegex: `if (match[0].endsWith('/>')) continue`
3. Non-greedy regex in extractContent: `[^>]*?` instead of `[^>]*`

## FILL Before appendChild (c69d448)
**Symptom**: "FILL can only be set on children of auto-layout frames" error
**Cause**: `layoutSizingHorizontal = 'FILL'` set before `appendChild()`
**Fix**: Move FILL sizing assignment after appendChild call

## Default Padding on Nested Frames (c69d448)
**Symptom**: Components look broken with unexpected spacing
**Cause**: Default padding 16/10 applied to ALL nested frames (intended only for buttons)
**Fix**: Changed defaults to 0/0: `fPx = item.px !== undefined ? item.px : (fP !== null ? fP : 0)`

## grow={1} Using Deprecated API (c69d448)
**Symptom**: grow not working correctly, vertical overflow
**Cause**: Used deprecated `layoutGrow` instead of `layoutSizingHorizontal/Vertical = 'FILL'`
**Fix**: Map grow based on parent flex direction using new API

## Old vs New Figma API Conflict (c69d448)
**Symptom**: Sizing conflicts between old and new API
**Cause**: Mixed use of `primaryAxisSizingMode`/`counterAxisSizingMode` (old) and `layoutSizingHorizontal`/`layoutSizingVertical` (new)
**Fix**: Use `layoutSizingHorizontal`/`layoutSizingVertical` for children, keep `primaryAxisSizingMode`/`counterAxisSizingMode` for root frame self-sizing only

## `connect` Deadlock: "Quit Figma (Cmd+Q)" Forever (2026-08-19)
**Symptom**: `connect` printed "Figma is running, but the debug port is not open. Quit Figma (Cmd+Q), then run connect again." Quitting Figma changed nothing — the same message on every retry, and Figma was never relaunched.
**Cause**: `isFigmaRunning()` used `pgrep -f Figma`. `-f` matches the whole command line, so it hit processes that are not Figma Desktop: `~/Library/Application Support/Figma/FigmaAgent.app/.../figma_agent` (Figma's updater, running while Figma is closed) and `/Applications/FigmaClaude.app` plus its three helpers. `figmaRunning` was therefore always true, `resolveConnectAction({cdpReachable: false, figmaRunning: true})` always answered `needs-quit`, and the `start-fresh` branch that calls `startFigma()` was unreachable.
**Fix**: `figmaRunningCommand(platform)` in `src/platform.js` — `pgrep -x Figma` on darwin, `pgrep -x figma` on linux, tasklist filter unchanged on win32. `-x` matches the process name, which is what `killFigmaApp`, `bin/fig-start`, `bin/fig-status` and `app/src/host/figmaActions.ts` already did.
**Location**: `src/platform.js:290` (the only `-f` in the repo), tests in `tests/figma-running.test.js`
**Verified**: after the fix, `isFigmaRunning()` returned false with Figma quit, `connect` took `start-fresh`, and the launched process carried `--remote-debugging-port=9222` with CDP answering `200`.

## `install:app` Reported "Nothing built" on Apple Silicon (2026-08-19)
**Symptom**: `npm run install:app` in `app/` ran the build to completion, then failed with "✗ Nothing built at .../app/release/mac/FigmaClaude.app — run `npm run dist` first."
**Cause**: electron-builder names its output directory after the target arch — `release/mac` on x64, `release/mac-arm64` on arm64. `scripts/install-app.mjs` hardcoded `release/mac`, so the script never found a bundle built on an M-series Mac.
**Fix**: `findBundle()` scans `release/` for the first `mac*/FigmaClaude.app`; the error message now names `release/mac*/`.
**Location**: `app/scripts/install-app.mjs`
