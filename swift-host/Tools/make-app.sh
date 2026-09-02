#!/bin/bash
# Assembles the app bundle around the release binary.
#
# The app is "Figma Claude" everywhere a person reads it, and that takes two different things:
# the menu bar takes CFBundleName, while Finder and the Dock label take the *file name* — measured
# on Brave, which is `Brave Browser.app` with CFBundleName "Brave" and shows both. So the bundle
# directory carries the space too.
#
# The executable inside does not: it stays `FigmaClaude`, because `pgrep -x` addresses it by that
# name and a space in an argv[0] is a trap nobody needs.
#
# There is no `xcodebuild` here — this machine has the Command Line Tools only — and none is
# needed: an .app is a directory with an Info.plist. Without it LaunchServices does not treat the
# binary as an application at all: run from a terminal it inherits Terminal's Dock icon and never
# properly activates, which looks like "the window did not open".

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/build/Figma Claude.app}"
BINARY="$ROOT/.build/release/FigmaClaude"

if [ ! -x "$BINARY" ]; then
    echo "✗ No release binary — run 'swift build -c release' first." >&2
    exit 1
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cp "$BINARY" "$APP/Contents/MacOS/FigmaClaude"
# The binary carries debug symbols the app does not need; stripping is most of the size.
strip -no_code_signature_warning "$APP/Contents/MacOS/FigmaClaude" 2>/dev/null || true

# The Swift host's own version, hand-set in swift-host/VERSION. It used to be read from
# `app/package.json` — the Electron twin's number, stuck at 1.0.0 since the port, so the About
# box showed a version that belonged to another program and never moved.
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION" 2>/dev/null || echo "0.0.0")"

# The commit the bundle was built from, and its date. CFBundleVersion is what the standard About
# panel prints in parentheses after the version, which makes "which build is this?" answerable
# from the running app. Empty when git has nothing to say — a tarball build still works.
COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "")"
BUILD_DATE="$(git -C "$ROOT" log -1 --format=%cs 2>/dev/null || date +%Y-%m-%d)"
if [ -n "$COMMIT" ] && [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]; then
    # An uncommitted tree does not match its commit; saying so beats a SHA that lies.
    COMMIT="$COMMIT+"
fi

# One icon for both hosts rather than a second 646 KB copy that drifts. The Electron half owns
# it (`app/build/icon.icns`, built from `icon.png` with iconutil); the same path the version is
# read from, and missing just as gracefully — without an icon the app still runs, it only
# inherits the generic one.
ICON_SRC="$ROOT/../app/build/icon.icns"
ICON_KEY=""
if [ -f "$ICON_SRC" ]; then
    cp "$ICON_SRC" "$APP/Contents/Resources/icon.icns"
    ICON_KEY="    <key>CFBundleIconFile</key>          <string>icon.icns</string>"
else
    echo "  (no icon at $ICON_SRC — bundle gets the generic one)" >&2
fi

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>              <string>Figma Claude</string>
    <key>CFBundleDisplayName</key>       <string>Figma Claude</string>
    <key>CFBundleIdentifier</key>        <string>de.designdone.figmaclaude.swift</string>
    <key>CFBundleExecutable</key>        <string>FigmaClaude</string>
$ICON_KEY
    <key>CFBundlePackageType</key>       <string>APPL</string>
    <key>CFBundleShortVersionString</key><string>$VERSION</string>
    <key>CFBundleVersion</key>           <string>${COMMIT:-$VERSION}</string>
    <!-- Read by the About panel; not an Apple key, so it needs the prefix. -->
    <key>FCBuildDate</key>               <string>$BUILD_DATE</string>
    <key>LSMinimumSystemVersion</key>    <string>13.0</string>
    <!-- A terminal is a document-less app that still owns a window and a menu bar. -->
    <key>LSUIElement</key>               <false/>
    <key>NSHighResolutionCapable</key>   <true/>
</dict>
</plist>
PLIST

# Ad-hoc signature: unsigned bundles are refused outright on Apple Silicon, and even here it
# stops the "damaged" dialog after the bundle is replaced in place.
codesign --force --deep --sign - "$APP" 2>/dev/null || echo "  (codesign skipped)"

# The bundle was called FigmaClaude.app until 2026-09-02. A build from before the rename sits
# next to the new one and keeps running from there, so it is named rather than deleted — removing
# a bundle while it runs is what broke `install:app` once already.
STALE="$ROOT/build/FigmaClaude.app"
if [ -d "$STALE" ] && [ "$STALE" != "$APP" ]; then
    echo "  ! $STALE is the pre-rename bundle — quit it, then: rm -rf \"$STALE\"" >&2
fi

echo "✓ $APP  $VERSION (${COMMIT:-no commit}, $BUILD_DATE)"
du -sh "$APP" | awk '{print "  " $1}'
