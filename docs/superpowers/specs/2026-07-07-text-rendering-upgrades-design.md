# figma-cli `<Text>` rendering upgrades

**Date:** 2026-07-07
**Status:** Approved (design)
**Area:** JSX renderer (`src/figma-client.js`)

## Motivation

Building a full slide deck from an HTML source surfaced three concrete gaps in how
the JSX renderer turns `<Text>` into Figma text nodes. Each forced a manual
workaround and lost fidelity versus the HTML original:

1. **Numeric `w` on `<Text>` is silently ignored inside `flex="row"`.** Only
   `w="fill"` (or a text child of a fixed-size column) wraps. A numeric width made
   the text hug and overflow, so every wrapping paragraph inside a horizontal row
   had to be wrapped in an extra fixed-width `Frame`.
2. **No inline rich text.** The content regex `([^<]*)` stops at the first `<`, so
   `<Text>a <b>bold</b> c</Text>` fails to match and is dropped. A single `<Text>`
   is one uniform run, so the common "muted sentence with one white/bold word"
   pattern was impossible; all emphasis had to be flattened to one color.
3. **No HTML-entity decoding.** `&#8250;`, `&amp;`, `&rarr;` are emitted literally.

All three are confirmed in `src/figma-client.js`:
- text codegen branch (`~:1102-1148`) sets `textAutoResize` / `layoutSizingHorizontal`
  only for `w="fill"` or a fixed-size-column child; a numeric width path does not exist.
- `parseChildren()` Text regex (`~:915`) captures content as `([^<]*)`; content is
  written once via `el.characters = JSON.stringify(content)` with a single `fontName`.
  There is no `setRange*` call anywhere in the codebase.
- content is stored raw; no decode step exists.

## Goals

- Numeric `w={n}` on `<Text>` produces a fixed-width, wrapping text node in any parent
  (horizontal auto-layout, vertical auto-layout, or absolute).
- Inline runs within one `<Text>`: `<b>/<strong>` (bold), `<em>/<i>` (italic),
  `<u>` (underline), and `<span>` with arbitrary style overrides
  (`weight`, `italic`, `color`, `size`, `letterSpacing`). Runs inherit the base
  `<Text>` style; span attrs override.
- Named + numeric HTML entities decode in all text content.
- Full backward compatibility: a `<Text>` with no inline tags renders exactly as today.

## Non-goals (YAGNI)

- No block elements (Frame/etc.) inside `<Text>`.
- No nested `<Text>` for runs (`<span>` covers arbitrary overrides).
- No full HTML5 entity table; a curated common map only.
- No CSS-string / `style=` parsing on runs.

## Design

All changes live in `src/figma-client.js`. Three pure, exported helpers carry the
logic so they can be unit-tested without a live Figma.

### 1. Numeric-width wrapping

In the text codegen branch, detect a numeric `w` (a number, or a numeric string
that is not the keyword `"fill"`). When present, emit:

- `el.textAutoResize = 'HEIGHT'` (wrap horizontally, grow vertically), and
- inside auto-layout: `el.layoutSizingHorizontal = 'FIXED'` then set the width;
- absolute (no auto-layout parent): `el.resize(W, el.height)`.

Ordering: `textAutoResize` is set before the width so the height is recomputed for the
wrapped width. Existing `w="fill"` and column-autofill paths are unchanged; an explicit
numeric `w` takes precedence over the autofill default.

### 2. `decodeEntities(str)` — exported pure helper

Decodes:
- numeric decimal `&#NN;` and hex `&#xHH;` (via `String.fromCodePoint`), and
- a curated named map: `amp lt gt quot apos nbsp copy reg trade hellip mdash ndash
  times divide rarr larr uarr darr rsquo lsquo ldquo rdquo bull middot deg plusmn
  ne le ge approx` (extendable).

Unknown entities are left verbatim. Applied to plain text content and to each run's
text (Feature 3) immediately before the string reaches `el.characters`. Safe because
content is captured only after the opening `<`, so decoding `&lt;` → `<` cannot feed
a `<` back into the tag parser.

### 3. `parseTextRuns(inner)` — exported pure helper + inline codegen

**Parser change:** the `<Text>` content capture becomes non-greedy up to the first
`</Text>` so inline tags survive (`([\s\S]*?)</Text>`). Only inline run tags are
recognized inside a `<Text>`; there is no valid case for a block element inside text.

**`parseTextRuns(inner)`** returns `{ text, runs }` where `text` is the full decoded
string and `runs` is an array of `{ start, end, style }` (UTF-16 offsets, half-open):

- `<b>`/`<strong>` → `{ weight: 'bold' }`
- `<em>`/`<i>` → `{ italic: true }`
- `<u>` → `{ underline: true }`
- `<span weight= italic= color= size= letterSpacing=>` → those overrides
- plain text between tags → a run with empty style (inherits base)

Internal runs of whitespace/newlines collapse to a single space (clean multi-line
authoring). Entity decoding is applied per run.

**Codegen:**
1. Set base node props (fontName, size, fills, align, lineHeight, letterSpacing) as today.
2. `el.characters = <full string>`.
3. Preload fonts: for every distinct `(family, style)` used across runs, emit
   `await figma.loadFontAsync(...)`, each in a `try/catch` that falls back to the base
   style if a weight is unavailable for the family. Combined weight+italic maps through
   the existing `weightToStyle` (e.g. `Bold`, `Italic`, `Bold Italic`, `Semi Bold`).
4. Per run with non-empty style, emit the matching `setRange*` calls over `[start,end)`:
   `setRangeFontName`, `setRangeFontSize`, `setRangeFills`, `setRangeTextDecoration`,
   `setRangeLetterSpacing`.

**Fast path / back-compat:** when `parseTextRuns` yields a single run covering the whole
string with empty style (i.e. no inline tags), emit no `setRange*` calls, identical output
to today. This keeps `text-typography.test.js` and friends green.

## Edge cases

- **Missing font weight for a custom family:** `loadFontAsync` is wrapped in try/catch;
  on failure the run keeps the base style rather than throwing (a render must not abort).
- **`</Text>` inside content:** impossible (it is a tag), so the non-greedy match is safe.
- **Emoji / surrogate pairs:** offsets use JS string length (UTF-16 code units), matching
  Figma's `setRange*` indexing.
- **Whitespace normalization** only collapses internal whitespace and trims leading/trailing;
  for existing single-line content this is a no-op.

## Files & tests

- `src/figma-client.js` — parser change, numeric-width path, inline codegen; export
  `decodeEntities` and `parseTextRuns`.
- `tests/entities.test.js` — `decodeEntities` unit tests (numeric, hex, named, unknown).
- `tests/text-richtext.test.js` — `parseTextRuns` unit tests + `parseJSX` regex asserts
  that `<b>`/`<span>` emit `setRangeFontName` / `setRangeFills` over correct ranges, and
  that a plain `<Text>` emits none (fast path).
- `tests/text-width-wrap.test.js` — `parseJSX` asserts numeric `w` in a `flex="row"`
  emits `textAutoResize = 'HEIGHT'` + fixed horizontal sizing.
- `README.md` — JSX Text section: numeric `w` wraps; inline `<b>/<em>/<u>/<span>`; entities.

## Commits

Conventional, one feature per commit:
- `feat(render): wrap <Text> at a numeric width`
- `feat(render): decode HTML entities in <Text> content`
- `feat(render): inline rich-text runs in <Text> (<b>/<em>/<u>/<span>)`
- `docs(readme): document <Text> wrapping, inline runs, entities`
