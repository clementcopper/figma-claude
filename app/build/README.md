# Icon

The artwork is shape data in `icon-src/artwork.mjs`, rendered by `render-icon.mjs`:

```bash
node build/render-icon.mjs icon      build/icon.png       1024
node build/render-icon.mjs iconSmall build/icon-small.png 1024
```

Then the `.icns` (the small drawing carries 16 and 32 px, the large one everything above):

```bash
mkdir -p build/FigmaClaude.iconset
sips -z 16 16 build/icon-small.png --out build/FigmaClaude.iconset/icon_16x16.png
# … 16@2x, 32, 32@2x from icon-small.png; 128 … 512@2x from icon.png …
iconutil -c icns build/FigmaClaude.iconset -o build/icon.icns
```

## Why not SVG

macOS renders SVG through `qlmanage`, but it composites onto **white** — that is where the white
block behind the icon came from. Driving a browser to rasterise a single file was the heavier
alternative, so `render-icon.mjs` draws rounded rectangles, circles and capsules directly, with
4×4 supersampling and a PNG writer over `zlib`. About two seconds per icon, no dependency.

## Measurements

Apple's macOS icon grid: 1024 canvas, body 824×824 centred (100 px margin), corner radius
185.4 = 0.225 × 824. The margin is not decoration — every other app in the Dock keeps it, so an
icon without it stands out as oversized.

Original artwork: Figma's logo is a trademark and is deliberately not reproduced.
