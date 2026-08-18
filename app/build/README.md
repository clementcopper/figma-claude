# Icon

`icon.png` is the master — 1024 × 1024, RGBA, designed in Figma and exported at @2x. It already
follows Apple's macOS grid: the body measures 823 × 823 at (100, 100), so a 100 px margin all
round, with the soft shadow reaching a little further down and right.

`icon-flat.png` is that export unchanged. `icon.png` is the same picture with the flat shapes
recoloured, because neither brand uses its flat palette in its own app icon — both give every
shape a vertical gradient and push it beyond the brand value:

| Fläche | flach im Export | im Icon |
|---|---|---|
| Claude-Figur | `#D97757` | `#E28458` → `#D45C30` |
| rot | `#F24E1E` | `#FD3636` → `#EF2E2E` |
| violett | `#A259FF` | `#854DFC` → `#7541E5` |
| grün | `#0ACF83` | `#23C86F` → `#32CF7A` |
| blau | `#1ABCFE` | `#17BDFF` → `#06B6FD` |

The dot values are measured from Figma's own icon. The figure goes a little past Claude's
(`#D98063 → #DB6944`) on purpose: Claude's icon sits on white, this one on `#1B1B1B`, where a
mid-bright terracotta gives way next to the dots. `tint-dots.py` applies them. It works out how much of each pixel belongs to a dot, so the anti-aliased rim
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
