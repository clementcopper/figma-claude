# Icon

`icon.png` is the master — 1024 × 1024, RGBA, designed in Figma and exported at @2x. It already
follows Apple's macOS grid: the body measures 823 × 823 at (100, 100), so a 100 px margin all
round, with the soft shadow reaching a little further down and right.

`icon-flat.png` is that export unchanged. `icon.png` is the same picture with the four dots
recoloured: Figma's own Dock icon does not use the flat brand palette, it gives every shape a
vertical gradient, and `tint-dots.py` puts the measured ones (`#FD3636 → #EF2E2E` and friends)
onto the dots. It works out how much of each pixel belongs to a dot, so the anti-aliased rim
survives — replacing the colour outright would leave a hard edge.

```bash
python3 build/tint-dots.py build/icon-flat.png build/icon.png
```

After a fresh export from Figma: overwrite `icon-flat.png`, run that line, then build the
iconset below.

Everything else is generated from it:

```bash
mkdir -p build/FigmaClaude.iconset
sips -z 16 16 build/icon.png --out build/FigmaClaude.iconset/icon_16x16.png
# … 16@2x, 32, 32@2x, 128, 128@2x, 256, 256@2x, 512 …
cp build/icon.png build/FigmaClaude.iconset/icon_512x512@2x.png
iconutil -c icns build/FigmaClaude.iconset -o build/icon.icns
```

`icon.icns` goes into the packaged bundle; `icon.png` is what `app.dock.setIcon` uses while
running from source, where the Dock name still comes from Electron's own bundle.

Earlier versions drew the icon from shape data and carried a simplified second drawing for 16
and 32 px. Both are gone: with a designed icon, a different mark at small sizes would be a
different icon. Git history has the generator if it is ever wanted again.

Every size comes out of one file, so check the small ones after a change — `sips` downscales
well, but four dots in a row can merge at 16 px.
