# Icon

`icon-src/variants.mjs` holds the artwork as SVG. Rendering is a two-liner, no image library:

```bash
node -e "import('./build/icon-src/variants.mjs').then(m=>require('fs').writeFileSync('build/icon-A.svg', m.variantA))"
qlmanage -t -s 1024 -o build build/icon-A.svg     # macOS renders SVG itself
cp build/icon-A.svg.png build/icon.png
```

`build/icon.png` is what `app.dock.setIcon` uses while running from source — the Dock name still
reads "Electron" there, because that name comes from the bundle's Info.plist and only a packaged
build has its own.

Original artwork: Figma's logo is a trademark and is deliberately not reproduced.
