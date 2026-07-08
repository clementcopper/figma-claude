# `<Text>` Rendering Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the figma-cli JSX `<Text>` renderer wrap at a numeric width, decode HTML entities, and support inline rich-text runs (`<b>/<em>/<u>/<span>`).

**Architecture:** All logic lives in `src/figma-client.js`. Two new pure methods (`decodeEntities`, `parseTextRuns`) are unit-tested directly. The parser (`parseChildren`), font collector (`collectFontsAndVarUsage`), and text codegen branch (`generateChildrenCode`) are extended. Tests assert on `parseJSX()`'s generated-code string (no live Figma), matching the repo's existing test style.

**Tech Stack:** Node.js, ESM, `node:test` runner (`node --test tests/*.test.js`).

## Global Constraints

- No new runtime dependencies (entity decoding is hand-rolled).
- Full backward compatibility: a `<Text>` with no inline tags must generate identical output to today (single run, no `setRange*` calls) so existing tests stay green.
- Run color overrides accept hex only (`#fff` / `#ffffff`); `var:` refs on inline runs are out of scope.
- Inline runs inherit the base `<Text>` style; only `<span>` attrs override. No font-family override on runs.
- UTF-16 code-unit offsets (JS string `.length`) for all `setRange*` ranges.
- Commits are Conventional Commits, one deliverable per commit.

---

### Task 1: `decodeEntities` helper + apply to plain text content

**Files:**
- Modify: `src/figma-client.js` (add `decodeEntities` method; apply in `parseChildren` Text branch near `:923`)
- Test: `tests/entities.test.js` (create)

**Interfaces:**
- Produces: `client.decodeEntities(str: string): string` — decodes numeric (`&#NN;`, `&#xHH;`) and a curated named set; leaves unknown entities verbatim.

- [ ] **Step 1: Write the failing test**

Create `tests/entities.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FigmaClient } from '../src/figma-client.js';

describe('decodeEntities', () => {
  const client = new FigmaClient();

  it('decodes named entities', () => {
    assert.equal(client.decodeEntities('a &amp; b'), 'a & b');
    assert.equal(client.decodeEntities('x &rarr; y'), 'x → y');
    assert.equal(client.decodeEntities('&lt;tag&gt;'), '<tag>');
  });

  it('decodes decimal and hex numeric entities', () => {
    assert.equal(client.decodeEntities('&#8250;'), '›');
    assert.equal(client.decodeEntities('&#x203A;'), '›');
  });

  it('leaves unknown entities untouched', () => {
    assert.equal(client.decodeEntities('&bogus; &notreal;'), '&bogus; &notreal;');
  });

  it('is a no-op on strings without &', () => {
    assert.equal(client.decodeEntities('plain text'), 'plain text');
  });
});

describe('parseJSX decodes entities in <Text>', () => {
  const client = new FigmaClient();
  it('emits decoded characters', async () => {
    const code = await client.parseJSX('<Frame name="P" flex="col"><Text size={14}>6 calls &#8250; done</Text></Frame>');
    assert.ok(code.includes('6 calls › done'), 'decoded › in characters');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/entities.test.js`
Expected: FAIL — `client.decodeEntities is not a function`.

- [ ] **Step 3: Add the `decodeEntities` method**

In `src/figma-client.js`, immediately BEFORE `hexToRgb(hex) {` (currently `:1806`), insert:

```js
  /**
   * Decode a curated set of HTML entities (numeric + named) in text content.
   * Hand-rolled (no dependency). Unknown entities are left verbatim.
   */
  decodeEntities(str) {
    if (typeof str !== 'string' || str.indexOf('&') === -1) return str;
    const named = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
      copy: '©', reg: '®', trade: '™', hellip: '…',
      mdash: '—', ndash: '–', times: '×', divide: '÷',
      rarr: '→', larr: '←', uarr: '↑', darr: '↓',
      rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
      bull: '•', middot: '·', deg: '°', plusmn: '±',
      ne: '≠', le: '≤', ge: '≥', approx: '≈',
    };
    return str.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, body) => {
      if (body[0] === '#') {
        const cp = (body[1] === 'x' || body[1] === 'X')
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        if (Number.isFinite(cp) && cp >= 0 && cp <= 0x10FFFF) {
          try { return String.fromCodePoint(cp); } catch (e) { return m; }
        }
        return m;
      }
      const key = body.toLowerCase();
      return Object.prototype.hasOwnProperty.call(named, key) ? named[key] : m;
    });
  }
```

Then in `parseChildren`, change the Text content assignment (currently `:923`) from:

```js
        textProps.content = match[2];
```

to:

```js
        textProps.content = this.decodeEntities(match[2]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/entities.test.js`
Expected: PASS (all 5).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `node --test tests/*.test.js`
Expected: PASS across the board.

- [ ] **Step 6: Commit**

```bash
git add src/figma-client.js tests/entities.test.js
git commit -m "feat(render): decode HTML entities in <Text> content

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Numeric `w` wraps `<Text>`

**Files:**
- Modify: `src/figma-client.js` (text branch of `generateChildrenCode`, currently `:1102-1148`)
- Test: `tests/text-width-wrap.test.js` (create)

**Interfaces:**
- Consumes: existing `item.w`, `parentFlex`, `autoFill` machinery.
- Produces: when `item.w` is numeric, generated code sets `textAutoResize='HEIGHT'`, `layoutSizingHorizontal='FIXED'` (try/catch), and `resize(W, height)` (try/catch).

- [ ] **Step 1: Write the failing test**

Create `tests/text-width-wrap.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FigmaClient } from '../src/figma-client.js';

function assertValidJs(code) {
  assert.doesNotThrow(() => new Function(code), SyntaxError);
}

describe('numeric width wraps <Text> in a row', () => {
  const client = new FigmaClient();

  it('emits HEIGHT autoresize + fixed sizing + resize for w={200} in flex=row', async () => {
    const code = await client.parseJSX('<Frame name="P" flex="row"><Text size={14} w={200}>a very long line of text that should wrap</Text></Frame>');
    assert.ok(/textAutoResize = 'HEIGHT'/.test(code), 'HEIGHT autoresize');
    assert.ok(/layoutSizingHorizontal = 'FIXED'/.test(code), 'FIXED sizing');
    assert.ok(/\.resize\(200,/.test(code), 'resize to 200');
    assertValidJs(code);
  });

  it('does not add fixed-width code for w="fill"', async () => {
    const code = await client.parseJSX('<Frame name="P" flex="row"><Text size={14} w="fill">x</Text></Frame>');
    assert.ok(!/\.resize\(/.test(code), 'no resize for fill');
    assert.ok(/layoutSizingHorizontal = 'FILL'/.test(code), 'FILL path kept');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/text-width-wrap.test.js`
Expected: FAIL — first test finds no `resize(200,` / `FIXED`.

- [ ] **Step 3: Add the numeric-width path**

In the text branch of `generateChildrenCode`, after the line:

```js
          const fillWidth = item.w === 'fill';
```

insert:

```js
          const numW = (item.w !== undefined && item.w !== 'fill' && item.w !== 'hug' && item.w !== 'auto' && !isNaN(Number(item.w))) ? Number(item.w) : null;
```

Change the `autoFill` line (currently `:1130`) from:

```js
          const autoFill = isCol && !fillWidth;
```

to:

```js
          const autoFill = isCol && !fillWidth && numW === null;
```

Then in the returned template literal, immediately AFTER the `${parentVar}.appendChild(el${idx});` line (currently `:1141`) and BEFORE the `${fillWidth && !parentNone ? ...}` line, insert:

```js
        ${numW !== null ? `el${idx}.textAutoResize = 'HEIGHT';
        try { el${idx}.layoutSizingHorizontal = 'FIXED'; } catch(e) {}
        try { el${idx}.resize(${numW}, el${idx}.height); } catch(e) {}` : ''}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/text-width-wrap.test.js`
Expected: PASS (both).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `node --test tests/*.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/figma-client.js tests/text-width-wrap.test.js
git commit -m "feat(render): wrap <Text> at a numeric width

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `parseTextRuns` pure helper

**Files:**
- Modify: `src/figma-client.js` (add `parseTextRuns` method, e.g. just after `weightToStyle` `:1028`)
- Test: `tests/text-richtext.test.js` (create)

**Interfaces:**
- Consumes: `client.decodeEntities` (Task 1), `client.parseProps` (existing).
- Produces: `client.parseTextRuns(inner: string): { text: string, runs: Array<{ start: number, end: number, style: object }> }`. `style` keys are a subset of `{ weight, italic, underline, color, size, letterSpacing }`; empty `{}` means "inherit base". Offsets are half-open UTF-16 indices into `text`.

- [ ] **Step 1: Write the failing test**

Create `tests/text-richtext.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FigmaClient } from '../src/figma-client.js';

describe('parseTextRuns', () => {
  const client = new FigmaClient();

  it('returns a single empty-style run for plain text (fast path)', () => {
    const { text, runs } = client.parseTextRuns('Hello world');
    assert.equal(text, 'Hello world');
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0].style, {});
    assert.equal(runs[0].start, 0);
    assert.equal(runs[0].end, 11);
  });

  it('marks a <b> run bold with correct offsets', () => {
    const { text, runs } = client.parseTextRuns('a <b>bold</b> c');
    assert.equal(text, 'a bold c');
    const boldRun = runs.find(r => r.style.weight === 'bold');
    assert.ok(boldRun, 'has a bold run');
    assert.equal(text.slice(boldRun.start, boldRun.end), 'bold');
  });

  it('reads span overrides (color, weight)', () => {
    const { text, runs } = client.parseTextRuns('x <span color="#FAFAFA" weight="bold">cli</span> y');
    assert.equal(text, 'x cli y');
    const span = runs.find(r => r.style.color === '#FAFAFA');
    assert.ok(span, 'has colored run');
    assert.equal(span.style.weight, 'bold');
    assert.equal(text.slice(span.start, span.end), 'cli');
  });

  it('maps <em> to italic and <u> to underline', () => {
    const r1 = client.parseTextRuns('<em>hi</em>').runs.find(r => r.style.italic === true);
    assert.ok(r1, 'italic run');
    const r2 = client.parseTextRuns('<u>hi</u>').runs.find(r => r.style.underline === true);
    assert.ok(r2, 'underline run');
  });

  it('collapses internal whitespace and trims outer', () => {
    const { text } = client.parseTextRuns('\n  keep   memory\n  empty\n');
    assert.equal(text, 'keep memory empty');
  });

  it('decodes entities inside runs', () => {
    const { text } = client.parseTextRuns('a <b>&amp;</b> b');
    assert.equal(text, 'a & b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/text-richtext.test.js`
Expected: FAIL — `client.parseTextRuns is not a function`.

- [ ] **Step 3: Add the `parseTextRuns` method**

In `src/figma-client.js`, immediately AFTER the `weightToStyle(...) { ... }` method (currently ends `:1028`), insert:

```js
  /**
   * Tokenize the inner content of a <Text> into styled runs.
   * Recognizes inline tags: <b>/<strong>, <em>/<i>, <u>, and <span ...>.
   * Plain text between tags inherits the base <Text> style (empty style {}).
   * Returns { text, runs } with half-open UTF-16 offsets into text.
   */
  parseTextRuns(inner) {
    inner = String(inner == null ? '' : inner).replace(/^\s+|\s+$/g, '');
    const runs = [];
    let text = '';
    const collapse = (s) => s.replace(/\s+/g, ' ');
    const stack = [];
    const curStyle = () => Object.assign({}, ...stack);
    const pushPlain = (raw) => {
      if (!raw) return;
      const decoded = this.decodeEntities(collapse(raw));
      if (!decoded) return;
      const start = text.length;
      text += decoded;
      runs.push({ start, end: text.length, style: curStyle() });
    };
    const tagRe = /<(\/?)(b|strong|em|i|u|span)((?:\s+[^>]*)?)>/gi;
    let last = 0, m;
    while ((m = tagRe.exec(inner)) !== null) {
      pushPlain(inner.slice(last, m.index));
      last = m.index + m[0].length;
      const closing = m[1] === '/';
      const tag = m[2].toLowerCase();
      if (closing) { if (stack.length) stack.pop(); continue; }
      let style;
      if (tag === 'b' || tag === 'strong') style = { weight: 'bold' };
      else if (tag === 'em' || tag === 'i') style = { italic: true };
      else if (tag === 'u') style = { underline: true };
      else {
        const p = this.parseProps((m[3] || '').trim());
        style = {};
        if (p.weight !== undefined) style.weight = p.weight;
        if (p.italic !== undefined) style.italic = p.italic;
        if (p.color !== undefined) style.color = p.color;
        if (p.size !== undefined) style.size = Number(p.size);
        if (p.letterSpacing !== undefined) style.letterSpacing = p.letterSpacing;
      }
      stack.push(style);
    }
    pushPlain(inner.slice(last));
    if (runs.length === 0) runs.push({ start: 0, end: 0, style: {} });
    return { text, runs };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/text-richtext.test.js`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add src/figma-client.js tests/text-richtext.test.js
git commit -m "feat(render): parseTextRuns tokenizer for inline <Text> runs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire runs into the parser, font collector, and codegen

**Files:**
- Modify: `src/figma-client.js` — `parseChildren` Text regex + `_runs`/`content`; `collectFontsAndVarUsage` text branch; `generateChildrenCode` text branch.
- Test: `tests/text-richtext.test.js` (append integration cases)

**Interfaces:**
- Consumes: `parseTextRuns` (Task 3), `weightToStyle`, `hexToRgb`, `hexToRgbCode`, `__font` (runtime), `dimUnit` (local in text branch).
- Produces: for a `<Text>` with styled runs, generated code contains `setRangeFontName` / `setRangeFills` / `setRangeTextDecoration` / `setRangeFontSize` / `setRangeLetterSpacing` over the run ranges. A plain `<Text>` emits none of these.

- [ ] **Step 1: Write the failing integration tests**

Append to `tests/text-richtext.test.js`:

```js
describe('parseJSX inline runs codegen', () => {
  const client = new FigmaClient();

  it('emits setRangeFontName for a <b> run and no setRange for plain text', async () => {
    const bold = await client.parseJSX('<Frame name="P" flex="col"><Text size={28} color="#9E9EA0">a <b>bold</b> c</Text></Frame>');
    assert.ok(/setRangeFontName\(2, 6,/.test(bold), 'bold range 2..6');
    assert.ok(bold.includes('a bold c'), 'flattened characters');

    const plain = await client.parseJSX('<Frame name="P" flex="col"><Text size={28}>just plain</Text></Frame>');
    assert.ok(!/setRange/.test(plain), 'no setRange calls for plain text (fast path)');
  });

  it('emits setRangeFills for a <span color> run', async () => {
    const code = await client.parseJSX('<Frame name="P" flex="col"><Text size={28} color="#9E9EA0">use <span color="#FAFAFA" weight="bold">figma-cli</span> now</Text></Frame>');
    assert.ok(/setRangeFills\(4, 13,/.test(code), 'colored range 4..13');
    assert.ok(/setRangeFontName\(4, 13,/.test(code), 'bold range 4..13');
    assert.ok(/r:0\.9803921568627451/.test(code) || /r:0\.98/.test(code), 'white-ish fill');
    assert.doesNotThrow(() => new Function(code), SyntaxError);
  });

  it('emits setRangeTextDecoration for <u>', async () => {
    const code = await client.parseJSX('<Frame name="P" flex="col"><Text size={28}>a <u>x</u></Text></Frame>');
    assert.ok(/setRangeTextDecoration\(2, 3, 'UNDERLINE'\)/.test(code), 'underline range');
  });
});
```

Note: offsets — `"a bold c"` has `bold` at 2..6; `"use figma-cli now"` has `figma-cli` at 4..13; `"a x"` has `x` at 2..3.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/text-richtext.test.js`
Expected: FAIL — the new cases find no `setRange*` (runs not wired yet).

- [ ] **Step 3a: Store runs in the parser**

In `parseChildren`, change the Text regex (currently `:915`) from:

```js
    const textRegex = /<Text(?:\s+([^>]*?))?>([^<]*)<\/Text>/g;
```

to (non-greedy, allows inline tags):

```js
    const textRegex = /<Text(?:\s+([^>]*?))?>([\s\S]*?)<\/Text>/g;
```

And change the content assignment (the line you edited in Task 1) from:

```js
        textProps.content = this.decodeEntities(match[2]);
```

to:

```js
        const __parsed = this.parseTextRuns(match[2]);
        textProps.content = __parsed.text;
        textProps._runs = __parsed.runs;
```

- [ ] **Step 3b: Register run fonts in the collector**

In `collectFontsAndVarUsage`, inside the `if (item._type === 'text') {` block (currently `:1036-1040`), after the existing `fontMap.set(...)` and `check(...)` lines, add:

```js
          if (Array.isArray(item._runs)) {
            item._runs.forEach(r => {
              const st = r.style || {};
              if (st.weight !== undefined || st.italic !== undefined) {
                const rStyle = this.weightToStyle(
                  st.weight !== undefined ? st.weight : item.weight,
                  st.italic !== undefined ? st.italic : item.italic
                );
                fontMap.set(family + '/' + rStyle, { family, style: rStyle });
              }
            });
          }
```

- [ ] **Step 3c: Emit run styling in the codegen**

In the text branch of `generateChildrenCode`, after the `const alignMapT = ...` / `dimUnit` definitions and before the `return \`` (i.e. alongside the other `t*` locals, after `:1125`), insert the run-code builder:

```js
          const runStyleCode = (item._runs || [])
            .filter(r => r.style && Object.keys(r.style).length)
            .map(r => {
              const st = r.style;
              const parts = [];
              if (st.weight !== undefined || st.italic !== undefined) {
                const rStyle = this.weightToStyle(
                  st.weight !== undefined ? st.weight : item.weight,
                  st.italic !== undefined ? st.italic : item.italic
                );
                parts.push(`try { el${idx}.setRangeFontName(${r.start}, ${r.end}, __font(${JSON.stringify(family)}, ${JSON.stringify(rStyle)})); } catch(e) {}`);
              }
              if (st.size !== undefined && !isNaN(Number(st.size))) {
                parts.push(`try { el${idx}.setRangeFontSize(${r.start}, ${r.end}, ${Number(st.size)}); } catch(e) {}`);
              }
              if (st.color && this.hexToRgb(st.color)) {
                parts.push(`try { el${idx}.setRangeFills(${r.start}, ${r.end}, [{ type: 'SOLID', color: ${this.hexToRgbCode(st.color)} }]); } catch(e) {}`);
              }
              if (st.underline) {
                parts.push(`try { el${idx}.setRangeTextDecoration(${r.start}, ${r.end}, 'UNDERLINE'); } catch(e) {}`);
              }
              if (st.letterSpacing !== undefined) {
                parts.push(`try { el${idx}.setRangeLetterSpacing(${r.start}, ${r.end}, ${dimUnit(st.letterSpacing)}); } catch(e) {}`);
              }
              return parts.join('\n        ');
            })
            .filter(Boolean)
            .join('\n        ');
```

Then in the returned template literal, immediately AFTER the `${textFillCode.code}` line (currently `:1140`) and before `${parentVar}.appendChild(el${idx});`, insert:

```js
        ${runStyleCode ? runStyleCode : ''}
```

(Placing run styling after `characters` is set and after base fills; `__font` is defined by the font-load preamble and the run fonts were registered in Step 3b, so `setRangeFontName` resolves a loaded font.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/text-richtext.test.js`
Expected: PASS (all cases, unit + integration).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `node --test tests/*.test.js`
Expected: PASS. If `text-typography.test.js` or `render-node-common-props.test.js` fail on whitespace, inspect: plain single-line content must be unchanged by `parseTextRuns` (collapse+trim is a no-op there).

- [ ] **Step 6: Commit**

```bash
git add src/figma-client.js tests/text-richtext.test.js
git commit -m "feat(render): apply inline rich-text runs to <Text> nodes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Document in README

**Files:**
- Modify: `README.md` (the JSX `<Text>` / render section)

**Interfaces:** none (docs only).

- [ ] **Step 1: Locate the JSX Text/props docs**

Run: `grep -nE "w=\"fill\"|<Text|JSX|render " README.md | head -20`
Expected: the section that lists `<Text>` props / render usage.

- [ ] **Step 2: Add documentation**

In that section, add a short block (adapt heading level to the surrounding doc):

```markdown
#### `<Text>` sizing and inline styling

- **Wrapping:** `w="fill"` fills the parent; a **numeric** `w={480}` sets a fixed
  width and wraps (works inside `flex="row"`, not just columns).
- **Inline runs:** style words inside one `<Text>` — `<b>`/`<strong>` (bold),
  `<em>`/`<i>` (italic), `<u>` (underline), and `<span weight= italic= color= size=
  letterSpacing=>` for arbitrary overrides. Runs inherit the base `<Text>` style;
  span attrs override. Run `color` is hex only.
- **HTML entities:** numeric (`&#8250;`, `&#x203A;`) and common named entities
  (`&amp; &lt; &gt; &rarr; &times; &hellip; &mdash; &nbsp;` …) are decoded.

```jsx
<Text size={28} w={620} color="#9E9EA0">
  An MCP server loads every tool, <b>confidently</b> wrong, while
  <span color="#FAFAFA" weight="bold">figma-cli</span> keeps memory empty.
</Text>
```
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): document <Text> wrapping, inline runs, entities

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Numeric-width wrapping → Task 2. ✓
- `decodeEntities` (numeric + named) → Task 1. ✓
- `parseTextRuns` (b/strong/em/i/u/span, inherit, whitespace collapse) → Task 3. ✓
- Parser non-greedy + `_runs`, font registration, `setRange*` codegen, fast-path back-compat → Task 4. ✓
- Exported/pure helpers with unit tests → Tasks 1, 3. ✓
- README → Task 5. ✓
- Edge cases: missing font (via `__font` fallback), `</Text>` literal impossible, UTF-16 offsets, whitespace no-op for single-line → covered in Tasks 3/4 code + tests. ✓

**Type consistency:** `parseTextRuns` returns `{ text, runs:[{start,end,style}] }` in Task 3 and is consumed with those exact names in Task 4 (`__parsed.text`, `__parsed.runs`, `r.style`, `r.start`, `r.end`). `weightToStyle(weight, italic)` signature reused consistently. `hexToRgb`/`hexToRgbCode` used per their existing signatures. ✓

**Placeholder scan:** every code step contains full code; no TBD/TODO. ✓
