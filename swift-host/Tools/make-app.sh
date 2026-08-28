#!/bin/bash
# Assembles FigmaClaude.app around the release binary.
#
# There is no `xcodebuild` here — this machine has the Command Line Tools only — and none is
# needed: an .app is a directory with an Info.plist. Without it LaunchServices does not treat the
# binary as an application at all: run from a terminal it inherits Terminal's Dock icon and never
# properly activates, which looks like "the window did not open".

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/build/FigmaClaude.app}"
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

VERSION="$(cd "$ROOT/../app" 2>/dev/null && node -e 'process.stdout.write(require("./package.json").version)' 2>/dev/null || echo "0.1.0")"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>              <string>FigmaClaude</string>
    <key>CFBundleDisplayName</key>       <string>FigmaClaude</string>
    <key>CFBundleIdentifier</key>        <string>de.designdone.figmaclaude.swift</string>
    <key>CFBundleExecutable</key>        <string>FigmaClaude</string>
    <key>CFBundlePackageType</key>       <string>APPL</string>
    <key>CFBundleShortVersionString</key><string>$VERSION</string>
    <key>CFBundleVersion</key>           <string>$VERSION</string>
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

echo "✓ $APP"
du -sh "$APP" | awk '{print "  " $1}'
