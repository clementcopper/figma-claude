/**
 * Figma CDP Client
 *
 * Connects directly to Figma via Chrome DevTools Protocol.
 * No external dependencies required.
 */

import WebSocket from 'ws';
import { getCdpPort } from './figma-patch.js';
import { resolveLeafSizing, resolveRootFill } from './lib/fill-sizing.js';
import { normalizeWeight, weightKey, buildStyleIndex, matchTextStyle } from './lib/text-styles.js';
import { autoFillDefeatsAlign } from './lib/text-autofill.js';
import { KNOWN_PROPS, PROP_ALIASES } from './lib/jsx-props.js';
import { coerceNumericProps } from './lib/jsx-numeric.js';
import { matchRootFrame } from './lib/root-frame.js';

/**
 * Visible fallback colors for shadcn semantic token names (Zinc light theme).
 * When a `var:` reference can't be resolved (e.g. the user never loaded any
 * variables, which is a totally valid choice), the renderer used to fall back
 * to opaque grey — which made shadcn components render as grey blocks with
 * invisible same-grey text. Falling back to the real default value instead
 * means components look correct WITHOUT forcing anyone to load a token set.
 * Values are 0–1 rgb floats (hex / 255).
 */
const SEMANTIC_VAR_DEFAULTS = {
  background: { r: 1, g: 1, b: 1 },
  foreground: { r: 0.039, g: 0.039, b: 0.043 },
  card: { r: 1, g: 1, b: 1 },
  'card-foreground': { r: 0.039, g: 0.039, b: 0.043 },
  popover: { r: 1, g: 1, b: 1 },
  'popover-foreground': { r: 0.039, g: 0.039, b: 0.043 },
  primary: { r: 0.094, g: 0.094, b: 0.106 },
  'primary-foreground': { r: 0.98, g: 0.98, b: 0.98 },
  secondary: { r: 0.957, g: 0.957, b: 0.961 },
  'secondary-foreground': { r: 0.094, g: 0.094, b: 0.106 },
  muted: { r: 0.957, g: 0.957, b: 0.961 },
  'muted-foreground': { r: 0.443, g: 0.443, b: 0.478 },
  accent: { r: 0.957, g: 0.957, b: 0.961 },
  'accent-foreground': { r: 0.094, g: 0.094, b: 0.106 },
  destructive: { r: 0.937, g: 0.267, b: 0.267 },
  'destructive-foreground': { r: 0.98, g: 0.98, b: 0.98 },
  border: { r: 0.894, g: 0.894, b: 0.906 },
  input: { r: 0.894, g: 0.894, b: 0.906 },
  ring: { r: 0.094, g: 0.094, b: 0.106 },
};

/**
 * Default layout direction for a Frame that doesn't say `flex`.
 *
 * The root path defaulted to 'col' and the nested path to 'row', so the SAME
 * `<Frame>` stacked its children vertically at the top level and laid them out
 * horizontally one level down. Direction silently depending on nesting depth is
 * the worst of the auto-layout footguns; both paths now read this constant.
 * 'col' is the safe default: children stack instead of colliding sideways.
 */
export const DEFAULT_FLEX = 'col';

const ALIGN_MAP = { start: 'MIN', center: 'CENTER', end: 'MAX', stretch: 'STRETCH' };
const JUSTIFY_MAP = { start: 'MIN', center: 'CENTER', end: 'MAX', between: 'SPACE_BETWEEN' };

/**
 * Resolve auto-layout alignment for ONE frame, at ANY nesting depth.
 *
 * Depth must never change layout. The root and nested code paths used to
 * default differently (root: MIN/MIN, nested: CENTER/CENTER via a flat
 * `|| 'CENTER'`), so the same JSX laid out differently depending on how deep
 * it sat — the single biggest source of "auto-layout is behaving weirdly".
 *
 * The one deliberate asymmetry is kept, and now applies everywhere:
 * a ROW centers its cross axis, because vertically centering icon+text in a
 * row is almost always what's wanted. Columns read top-left, like Figma.
 *
 * A frame with NO `flex` renders as VERTICAL (see layoutMode), so it must be
 * treated as a column here too — treating it as a row is what made plain
 * wrapper frames silently center their children.
 */
export function resolveAlign(flex, item = {}) {
  const isRow = flex === 'row' || flex === 'horizontal';
  const align = item.items || item.align || (isRow ? 'center' : 'start');
  const justify = item.justify || 'start';
  return {
    alignVal: ALIGN_MAP[align] || (isRow ? 'CENTER' : 'MIN'),
    justifyVal: JUSTIFY_MAP[justify] || ALIGN_MAP[justify] || 'MIN',
  };
}

/**
 * `minW`/`maxW`/`minH`/`maxH` were accepted as known props but never applied —
 * a silent no-op, the same class of footgun `stretch` used to be. Figma exposes
 * them as real constraints on auto-layout nodes, so emit them.
 *
 * Applied AFTER sizing so the clamp wins over FILL/HUG, guarded per property
 * because Figma throws on unsupported node types instead of ignoring the set.
 */
/**
 * Runtime prelude: report a child that FILLs an axis its parent HUGs.
 *
 * Figma's UI won't let you do this — "fill container" is disabled when the
 * parent hugs — but the Plugin API accepts it and resolves it to nothing, so
 * the element silently collapses and vanishes from the design. It is the most
 * common auto-layout failure and it leaves no error behind, which is exactly
 * why it kept getting rediscovered.
 *
 * Emitted once per render, used only by children that actually FILL.
 */
export const LAYOUT_WARN_PRELUDE = `
        {
          // Redefined on EVERY render, deliberately. Figma's globalThis persists
          // between evals, so an "install once" guard would pin whichever
          // version happened to run first in that Figma session — a stale
          // definition surviving a code change is exactly the kind of ghost that
          // wastes an afternoon.
          globalThis.__layoutWarnings = [];
          globalThis.__figHugPending = [];
          // Only RECORD here. Children are created in order, so later siblings
          // do not exist yet and judging now would flag the first child of every
          // row. __figHugFlush() runs once the tree is complete.
          globalThis.__figHugWarn = (child, axis) => {
            globalThis.__figHugPending.push({ child, axis });
          };
          globalThis.__figHugFlush = () => {
            for (const { child, axis } of globalThis.__figHugPending || []) {
              try {
                const p = child.parent;
                if (!p || !p.layoutMode || p.layoutMode === 'NONE') continue;
                // Which sizing mode governs an axis depends on the parent's
                // direction: for a VERTICAL parent width is the counter axis,
                // for HORIZONTAL it is the primary axis.
                const isPrimary = (axis === 'H') === (p.layoutMode === 'HORIZONTAL');
                const mode = isPrimary ? p.primaryAxisSizingMode : p.counterAxisSizingMode;
                if (mode !== 'AUTO') continue;
                // A hugging parent is only a problem when NOTHING establishes
                // the axis. A divider filling the height of a hug-height row is
                // correct: the text siblings set the height and the rule matches
                // it. Warn only when every child defers, so the size is circular
                // and Figma resolves it to the seed — a collapsed, invisible node.
                const sizingOf = (n) => (axis === 'H' ? n.layoutSizingHorizontal : n.layoutSizingVertical);
                const anchored = p.children.some((c) => c !== child && sizingOf(c) !== 'FILL');
                if (anchored) continue;
                globalThis.__layoutWarnings.push(
                  '"' + child.name + '" fills ' + (axis === 'H' ? 'width' : 'height') +
                  ', but its parent "' + p.name + '" hugs that axis and nothing else sets it'
                );
              } catch (e) {}
            }
            globalThis.__figHugPending = [];
          };
        }`;

/**
 * Runtime prelude: resolve and apply the file's TEXT STYLES.
 *
 * Without this every rendered text is an island of hardcoded values — it never
 * picks up a style, and `figma-cli analyze` flags it as "missing style".
 *
 * The matching rules are not written here. `src/lib/text-styles.js` owns them,
 * and its source is embedded below, so the unit tests exercise exactly the code
 * that runs inside Figma.
 *
 * The cache holds local styles PLUS every remote (library) style already used
 * by a text node on the page — a library style has no other name-addressable
 * route, since Figma only exposes remote styles by key.
 */
export const TEXT_STYLE_PRELUDE = `
        {
          ${normalizeWeight.toString()}
          ${weightKey.toString()}
          ${buildStyleIndex.toString()}
          ${matchTextStyle.toString()}

          globalThis.__textStyleWarnings = [];
          globalThis.__textStyleApplied = [];

          globalThis.__loadTextStyles = async () => {
            if (globalThis.__textStyleCache &&
                Date.now() - (globalThis.__textStyleCacheTime || 0) < 30000) {
              return globalThis.__textStyleCache;
            }
            const local = await figma.getLocalTextStylesAsync();
            const styles = local.map(s => ({
              id: s.id, name: s.name, fontSize: s.fontSize,
              fontName: { family: s.fontName.family, style: s.fontName.style },
            }));
            const known = new Set(styles.map(s => s.id));
            // Remote styles are only reachable by key, so harvest the ones the
            // document already uses — that is what a designer means by "the
            // styles in this file".
            try {
              const texts = figma.currentPage.findAllWithCriteria({ types: ['TEXT'] });
              const ids = new Set();
              for (const t of texts) {
                const id = t.textStyleId;
                if (typeof id === 'string' && id && !known.has(id)) ids.add(id);
              }
              for (const id of ids) {
                const st = await figma.getStyleByIdAsync(id);
                if (st && st.fontName) {
                  styles.push({
                    id: st.id, name: st.name, fontSize: st.fontSize,
                    fontName: { family: st.fontName.family, style: st.fontName.style },
                    remote: true,
                  });
                }
              }
            } catch (e) {}
            globalThis.__textStyleCache = { styles, index: buildStyleIndex(styles) };
            globalThis.__textStyleCacheTime = Date.now();
            return globalThis.__textStyleCache;
          };

          const __setStyle = async (node, style) => {
            await figma.loadFontAsync(style.fontName);
            await node.setTextStyleIdAsync(style.id);
            globalThis.__textStyleApplied.push(style.name);
          };

          // Explicit textStyle="…". Never throws: an unknown name is a warning
          // and the text still renders with its own props.
          globalThis.__applyTextStyle = async (node, name, explicit) => {
            try {
              const cache = await globalThis.__loadTextStyles();
              const style = cache.index[name];
              if (!style) {
                const available = Object.keys(cache.index).filter(n => n.indexOf('/') >= 0);
                globalThis.__textStyleWarnings.push(
                  'text style "' + name + '" not found' +
                  (available.length ? ' — available: ' + available.slice(0, 8).join(', ') : ' (this file has none)')
                );
                return;
              }
              await __setStyle(node, style);
              // A typographic prop written after the style would clear it, so
              // the conflicting props are reported rather than applied.
              const e = explicit || {};
              const clashes = [];
              if (e.size !== undefined && Number(e.size) !== Number(style.fontSize)) {
                clashes.push('size={' + e.size + '} vs ' + style.fontSize + 'px');
              }
              if (e.weightStyle && normalizeWeight(e.weightStyle) !== normalizeWeight(style.fontName.style)) {
                clashes.push('weight "' + e.weightStyle + '" vs ' + style.fontName.style);
              }
              if (e.family && e.family.toLowerCase() !== style.fontName.family.toLowerCase()) {
                clashes.push('font "' + e.family + '" vs ' + style.fontName.family);
              }
              if (e.lineHeight) clashes.push('lineHeight');
              if (e.letterSpacing) clashes.push('letterSpacing');
              if (clashes.length) {
                globalThis.__textStyleWarnings.push(
                  'textStyle="' + style.name + '" wins over ' + clashes.join(', ') +
                  ' — writing those would detach the style, so they were dropped'
                );
              }
            } catch (e) {
              globalThis.__textStyleWarnings.push('text style "' + name + '" failed: ' + e.message);
            }
          };

          // No textStyle given: apply the file's style when EXACTLY one matches
          // this text's size and weight. Several matches or none = do nothing
          // and say why; guessing would restyle text that was sized on purpose.
          globalThis.__autoTextStyle = async (node, want) => {
            try {
              const cache = await globalThis.__loadTextStyles();
              if (!cache.styles.length) return;
              const r = matchTextStyle({
                styles: cache.styles, size: want.size, weightStyle: want.weightStyle,
                family: want.family, familyExplicit: want.familyExplicit,
              });
              if (r.match) { await __setStyle(node, r.match); return; }
              const label = want.size + 'px ' + want.weightStyle;
              if (r.ambiguous) {
                globalThis.__textStyleWarnings.push(
                  'no style applied for ' + label + ' — ' + r.ambiguous.length +
                  ' styles match: ' + r.ambiguous.join(', ') + ' (name one with textStyle=)'
                );
              } else if (r.nearest) {
                globalThis.__textStyleWarnings.push(
                  'no text style for ' + label + ' — nearest: "' + r.nearest.name + '" (' +
                  r.nearest.fontSize + 'px ' + r.nearest.fontName.style + ')'
                );
              }
            } catch (e) {}
          };
        }`;

export function generateMinMaxCode(varName, item = {}) {
  const num = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(String(v).replace(/px$/, ''));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const pairs = [
    ['minWidth', num(item.minW !== undefined ? item.minW : item.minWidth)],
    ['maxWidth', num(item.maxW !== undefined ? item.maxW : item.maxWidth)],
    ['minHeight', num(item.minH !== undefined ? item.minH : item.minHeight)],
    ['maxHeight', num(item.maxH !== undefined ? item.maxH : item.maxHeight)],
  ].filter(([, v]) => v !== null);
  if (!pairs.length) return '';
  return pairs
    .map(([prop, v]) => `try { ${varName}.${prop} = ${v}; } catch (e) {}`)
    .join('\n        ');
}

export class FigmaClient {
  constructor() {
    this.ws = null;
    this.msgId = 0;
    this.callbacks = new Map();
    this.pageTitle = null;
    this.pageUrl = null;
    this.fileType = null; // 'design', 'file', or 'unknown'
    this.executionContextId = null; // For Figma v39+ sandboxed context
    // Optional: pin var:<name> resolution to a single Variable Collection.
    // Set via setCollection() or directly. Per-attribute `var:collection:name`
    // in JSX overrides this. nullish = use the global "shadcn first, then any"
    // fallback in the var-cache loader.
    this.collectionFilter = null;
    // Auto-apply a file text style to a <Text> that names none, when exactly
    // one style matches its size and weight. `--no-auto-style` turns it off.
    this.autoTextStyle = true;
  }

  /** Pin variable lookups to a specific collection (by case-insensitive name match). */
  setCollection(name) {
    this.collectionFilter = name || null;
  }

  /** Turn the automatic text-style matching on or off (JSX `textStyle=` still applies). */
  setAutoTextStyle(on) {
    this.autoTextStyle = on !== false;
  }

  /**
   * List all available Figma pages
   */
  static async listPages() {
    const port = getCdpPort();
    const response = await fetch(`http://localhost:${port}/json`);
    const pages = await response.json();
    return pages
      .filter(p => p.url && p.url.includes('figma.com'))
      .map(p => ({ title: p.title, id: p.id, url: p.url, wsUrl: p.webSocketDebuggerUrl }));
  }

  /**
   * Check if Figma is running with debug port
   */
  static async isConnected() {
    try {
      const port = getCdpPort();
      const response = await fetch(`http://localhost:${port}/json`);
      const pages = await response.json();
      return pages.some(p => p.url && p.url.includes('figma.com'));
    } catch {
      return false;
    }
  }

  /**
   * Connect to a Figma design file
   */
  async connect(pageTitle = null, { timeoutMs = 15000 } = {}) {
    const port = getCdpPort();
    const response = await fetch(`http://localhost:${port}/json`);
    const pages = await response.json();

    // Find design/file pages (not feed, home, etc.)
    // Use regex with trailing slash to avoid matching /files/ (feed/home pages)
    const isDesignPage = (p) =>
      p.url && /figma\.com\/(design|file)\//.test(p.url);

    let page;
    if (pageTitle) {
      page = pages.find(p => p.title.includes(pageTitle) && isDesignPage(p));
    } else {
      page = pages.find(isDesignPage);
    }

    if (!page) {
      throw new Error('No Figma design file open. Please open a design file in Figma Desktop.');
    }

    this.pageTitle = page.title;
    this.pageUrl = page.url;

    // Detect file type from URL
    const typeMatch = page.url.match(/figma\.com\/(design|file)\//);
    this.fileType = typeMatch ? typeMatch[1] : 'unknown';

    return new Promise((resolveConn, rejectConn) => {
      this.ws = new WebSocket(page.webSocketDebuggerUrl);
      const executionContexts = [];
      // The connect timer used to run on after a successful connect and held the process
      // open for up to 15 s; settle clears it.
      let settled = false;
      const timer = setTimeout(() => reject(new Error('Connection timeout')), timeoutMs);
      const resolve = (v) => { if (settled) return; settled = true; clearTimeout(timer); resolveConn(v); };
      const reject = (e) => { if (settled) return; settled = true; clearTimeout(timer); rejectConn(e); };

      this.ws.on('open', async () => {
        try {
          // Enable Runtime to discover execution contexts (needed for Figma v39+)
          await this.send('Runtime.enable');

          // Give time for context events to arrive
          await new Promise(r => setTimeout(r, 500));

          // First try default context (works on older Figma versions)
          const defaultCheck = await this.send('Runtime.evaluate', {
            expression: 'typeof figma !== "undefined"',
            returnByValue: true
          });

          if (defaultCheck.result?.result?.value === true) {
            // figma is in default context (older Figma)
            this.executionContextId = null;
            resolve(this);
            return;
          }

          // Figma v39+: search all execution contexts for figma
          for (const ctx of executionContexts) {
            try {
              const check = await this.send('Runtime.evaluate', {
                expression: 'typeof figma !== "undefined"',
                contextId: ctx.id,
                returnByValue: true
              });

              if (check.result?.result?.value === true) {
                this.executionContextId = ctx.id;
                resolve(this);
                return;
              }
            } catch {
              // Context may have been destroyed, skip
            }
          }

          reject(new Error('Could not find Figma execution context. Make sure a design file is open.'));
        } catch (err) {
          reject(err);
        }
      });

      this.ws.on('message', (data) => {
        const msg = JSON.parse(data);

        // Collect execution contexts as they're created
        if (msg.method === 'Runtime.executionContextCreated') {
          executionContexts.push(msg.params.context);
        }

        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          cb.resolve(msg);
        }
      });

      this.ws.on('error', reject);

      // Figma quit or the socket dropped: without this, `this.ws` stayed set with
      // readyState 3 and every pending send() waited forever.
      this.ws.on('close', () => {
        this.ws = null;
        this.rejectPending(new Error('CDP connection closed'));
        reject(new Error('CDP connection closed before Figma answered'));
      });
    });
  }

  /** Fail every request still waiting for an answer. */
  rejectPending(error) {
    for (const [id, cb] of this.callbacks) {
      this.callbacks.delete(id);
      if (cb.reject) cb.reject(error);
    }
  }

  /**
   * One CDP request. Rejects when the socket is not open, when it closes before the answer,
   * and after `timeoutMs` (default 90 s, the daemon's own eval ceiling) — a promise that
   * could never settle used to hang the direct CLI path indefinitely.
   */
  send(method, params = {}, { timeoutMs = 90000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) {
        reject(new Error('CDP socket is not open'));
        return;
      }
      const id = ++this.msgId;
      const timer = setTimeout(() => {
        this.callbacks.delete(id);
        reject(new Error(`CDP request ${method} timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.callbacks.set(id, {
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        clearTimeout(timer);
        this.callbacks.delete(id);
        reject(e);
      }
    });
  }

  /**
   * Evaluate JavaScript in the Figma context
   */
  async eval(expression) {
    if (!this.ws) {
      throw new Error('Not connected to Figma');
    }

    const params = {
      expression,
      returnByValue: true,
      awaitPromise: true
    };

    // Use specific execution context if found (Figma v39+)
    if (this.executionContextId) {
      params.contextId = this.executionContextId;
    }

    const result = await this.send('Runtime.evaluate', params);

    // A protocol-level error (stale execution context after navigation, bad params) comes
    // as { id, error } with no `result`; it used to fall through as a successful undefined.
    if (result.error) {
      throw new Error(result.error.message || 'CDP error ' + result.error.code);
    }

    if (result.result?.exceptionDetails) {
      const error = result.result.exceptionDetails;
      // Get the actual error message - Figma puts detailed errors in exception.value
      const errorValue = error.exception?.value || error.exception?.description || error.text || 'Evaluation error';
      throw new Error(errorValue);
    }

    return result.result?.result?.value;
  }

  /**
   * Get current page info
   */
  async getPageInfo() {
    return await this.eval(`
      (function() {
        return {
          name: figma.currentPage.name,
          id: figma.currentPage.id,
          childCount: figma.currentPage.children.length,
          fileKey: figma.fileKey
        };
      })()
    `);
  }

  /**
   * List all nodes on current page
   */
  async listNodes(limit = 50) {
    return await this.eval(`
      figma.currentPage.children.slice(0, ${limit}).map(function(n) {
        return {
          id: n.id,
          type: n.type,
          name: n.name || '',
          x: Math.round(n.x),
          y: Math.round(n.y),
          width: Math.round(n.width),
          height: Math.round(n.height)
        };
      })
    `);
  }

  /**
   * Render JSX-like syntax to Figma
   */
  async render(jsx) {
    // Parse JSX and generate Figma code (async for icon fetching)
    const code = await this.parseJSX(jsx);
    return await this.eval(code);
  }

  /**
   * Parse multiple JSX strings into a SINGLE eval call (10x faster)
   * Returns code that creates all frames and returns array of { id, name }
   */
  async parseJSXBatch(jsxArray, options = {}) {
    const gap = options.gap || 40;
    const vertical = options.vertical || false;

    // Parse each JSX to get props and children
    const parsed = jsxArray.map(jsx => {
      const openMatch = matchRootFrame(jsx);
      if (!openMatch) throw new Error('Invalid JSX: must start with <Frame>');
      const propsStr = openMatch.propsStr;
      const startIdx = openMatch.end;
      const children = this.extractContent(jsx.slice(startIdx), 'Frame');
      const props = this.parseProps(propsStr);
      const childElements = this.parseChildren(children);
      return { props, children: childElements };
    });

    // Pre-fetch any icon SVGs used in any frame (shared child generator
    // renders real Iconify SVGs, falling back to placeholders offline)
    const iconSvgMap = await this.prefetchIconSvgs(parsed.flatMap(p => p.children));

    // Collect all fonts needed ({ family, style } pairs, deduped)
    const allFontMap = new Map();
    const allFonts = [];
    let anyUsesVars = false;

    parsed.forEach(({ props, children }) => {
      const bg = props.bg || props.fill || null;
      const stroke = props.stroke || null;
      if (this.isVarRef(bg)) anyUsesVars = true;
      if (stroke && this.isVarRef(stroke)) anyUsesVars = true;

      const collected = this.collectFontsAndVarUsage(children);
      collected.fonts.forEach(f => {
        const key = f.family + '/' + f.style;
        if (!allFontMap.has(key)) { allFontMap.set(key, f); allFonts.push(f); }
      });
      if (collected.usesVars) anyUsesVars = true;
    });

    // Font caching: only load fonts not yet loaded in this session
    const fontLoads = this.generateFontLoadCode(allFonts);

    // Variable caching: reuse loaded vars across calls.
    // Loads ALL local variables in a single batched call (Figma's
    // getLocalVariablesAsync), then sorts shadcn-first so its names win when
    // multiple collections define the same token. Avoids N round-trips
    // when a user imports a Carbon / Material / DESIGN.md system with ~100
    // variables — the per-id loop made renders feel like a hang.
    // Resolve collection filter (case-insensitive substring), evaluated in
    // the host (we know the user-passed string here). Becomes a fixed set of
    // collection IDs that the Plugin-side resolver will restrict itself to.
    const colFilter = this.collectionFilter;
    const varLoadCode = anyUsesVars ? `
      // Compose the "collection scope" once per cache window. When a filter
      // is active, ONLY variables from collections whose name matches the
      // filter make it into the cache — every other token resolves to
      // "missing", which is correct: the caller chose this scope.
      if (!globalThis.__varsCache || globalThis.__varsCacheFilter !== ${JSON.stringify(colFilter)} ||
          Date.now() - (globalThis.__varsCacheTime || 0) > 30000) {
        const [collections, allVars] = await Promise.all([
          figma.variables.getLocalVariableCollectionsAsync(),
          figma.variables.getLocalVariablesAsync(),
        ]);
        const filter = ${JSON.stringify(colFilter)};
        const shadcnColIds = new Set(
          collections.filter(c => c.name.startsWith('shadcn')).map(c => c.id)
        );
        let scopedColIds = null;
        if (filter) {
          const fl = filter.toLowerCase();
          const scoped = collections.filter(c =>
            c.name.toLowerCase() === fl || c.name.toLowerCase().includes(fl)
          );
          scopedColIds = new Set(scoped.map(c => c.id));
        }
        globalThis.__varsCache = {};
        // Register a variable under its full name AND under its "tail" name
        // (the part after the last "/" in a slash-grouped name). So a token
        // named "colors/primary" can be resolved as either var:primary or
        // var:colors/primary. The full name always wins if both exist.
        const register = (v) => {
          if (!globalThis.__varsCache[v.name]) globalThis.__varsCache[v.name] = v;
          const slash = v.name.lastIndexOf('/');
          if (slash >= 0) {
            const tail = v.name.slice(slash + 1);
            if (tail && !globalThis.__varsCache[tail]) globalThis.__varsCache[tail] = v;
          }
        };
        if (scopedColIds) {
          for (const v of allVars) {
            if (scopedColIds.has(v.variableCollectionId)) register(v);
          }
        } else {
          for (const v of allVars) {
            if (shadcnColIds.has(v.variableCollectionId)) register(v);
          }
          for (const v of allVars) {
            if (!shadcnColIds.has(v.variableCollectionId)) register(v);
          }
        }
        // Also stash collection-name → id map for the var:collection:name
        // per-attribute override syntax. Same tail-aliasing applies.
        globalThis.__varsByCollection = {};
        for (const v of allVars) {
          const col = collections.find(c => c.id === v.variableCollectionId);
          if (!col) continue;
          const colKey = col.name.toLowerCase() + ':';
          globalThis.__varsByCollection[colKey + v.name] = v;
          const slash = v.name.lastIndexOf('/');
          if (slash >= 0) {
            const tail = v.name.slice(slash + 1);
            const alias = colKey + tail;
            if (tail && !globalThis.__varsByCollection[alias]) globalThis.__varsByCollection[alias] = v;
          }
        }
        globalThis.__varsCacheTime = Date.now();
        globalThis.__varsCacheFilter = filter;
      }
      const vars = globalThis.__varsCache;
      const varsByCollection = globalThis.__varsByCollection || {};
      // Lookup helper for the per-attr "var:collection:name" syntax. Falls
      // back to the scoped cache if the qualified key isn't found.
      const lookupVar = (key) => {
        if (key.includes(':')) {
          const [colName, varName] = key.split(':', 2);
          return varsByCollection[colName.toLowerCase() + ':' + varName] || vars[varName];
        }
        return vars[key];
      };
      // Collect names that callers asked for but didn't resolve so we can
      // surface them at the end instead of silently rendering grey.
      globalThis.__unresolvedVars = globalThis.__unresolvedVars || new Set();
      const __varDefaults = ${JSON.stringify(SEMANTIC_VAR_DEFAULTS)};
      const __defaultColor = (requestedKey) => {
        if (!requestedKey) return null;
        let k = String(requestedKey);
        const c = k.lastIndexOf(':'); if (c >= 0) k = k.slice(c + 1);
        const s = k.lastIndexOf('/'); if (s >= 0) k = k.slice(s + 1);
        return __varDefaults[k] || null;
      };
      const boundFill = (variable, requestedKey) => {
        if (!variable) {
          if (requestedKey) globalThis.__unresolvedVars.add(requestedKey);
          // No variable loaded for this name. Fall back to the semantic token's
          // real default color so the component stays VISIBLE (grey-on-grey made
          // text disappear). Unknown names still get neutral grey.
          return { type: 'SOLID', color: __defaultColor(requestedKey) || { r: 0.5, g: 0.5, b: 0.5 } };
        }
        return figma.variables.setBoundVariableForPaint(
          { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }, 'color', variable
        );
      };
    ` : '';

    // Generate code for each frame
    let anyText = false;
    const framesCodes = parsed.map(({ props, children }, frameIdx) => {
      const name = props.name || 'Frame';
      // "fill" / "hug" are sizing keywords that only make sense for nested
      // elements under an auto-layout parent. At top-level there's no parent
      // to fill against, so we ignore them and fall back to a sensible
      // numeric default. Without this filter, `w="fill"` interpolated raw
      // into `resize(fill, …)` → ReferenceError.
      const isNumeric = v => v !== undefined && v !== 'fill' && v !== 'hug';
      const rawW = isNumeric(props.w) ? props.w : isNumeric(props.width) ? props.width : undefined;
      const rawH = isNumeric(props.h) ? props.h : isNumeric(props.height) ? props.height : undefined;
      const hasExplicitWidth = rawW !== undefined;
      const width = rawW !== undefined ? rawW : 320;
      const hasExplicitHeight = rawH !== undefined;
      const height = rawH !== undefined ? rawH : 200;
      const bg = props.bg || props.fill || null;
      const stroke = props.stroke || null;
      const rounded = props.rounded || props.radius || 0;
      const flex = props.flex || DEFAULT_FLEX;
      const itemGap = props.gap || 0;
      const p = props.p || props.padding || 0;
      const px = props.px || p;
      const py = props.py || p;
      const wrap = props.wrap === true || props.wrap === 'true';
      const wrapGap = Number(props.wrapGap || props.rowGap || props.counterAxisSpacing || 0);
      const hug = props.hug || '';
      // Generic node-level visuals that just need straight property
      // assignment. Reading these here means callers can drop opacity / lock
      // / visible on any frame without us having to thread each through the
      // whole code-gen pipeline.
      const opacity = props.opacity !== undefined ? Number(props.opacity) : null;
      const visible = props.visible === false || props.visible === 'false' ? false : null;
      const locked = props.locked === true || props.locked === 'true' ? true : null;
      const hugWidth = hug === 'both' || hug === 'w' || hug === 'width';
      const hugHeight = hug === 'both' || hug === 'h' || hug === 'height';
      // Same as the single path: overflow="hidden" clips too.
      const clip = props.clip === 'true' || props.clip === true || props.overflow === 'hidden';
      // A frame with its own x/y sits there; the batch row layout is for the others.
      const ownX = props.x !== undefined ? Number(props.x) : null;
      const ownY = props.y !== undefined ? Number(props.y) : null;
      // w/h="fill" on a batch root has nothing to fill (no --parent here); say so, as
      // the single path does, instead of dropping it in silence.
      const rootFill = resolveRootFill({
        fillWidth: props.w === 'fill' || props.width === 'fill',
        fillHeight: props.h === 'fill' || props.height === 'fill',
        hasParent: false, name,
      });

      const { alignVal, justifyVal } = resolveAlign(flex, props);

      const fillCode = this.generateFillCode(bg, `f${frameIdx}`);
      const strokeCode = stroke ? this.generateStrokeCode(stroke, `f${frameIdx}`, props.strokeWidth || 1, props.strokeAlign || null) : { code: '' };
      const effectsCode = this.generateEffectsCode(props, `f${frameIdx}`);
      const imageCode = props.image ? this.generateImageFillCode(props.image, `f${frameIdx}`, props.imageScale) : '';

      const childCode = this.generateChildrenCode(children, `f${frameIdx}`, flex, { counter: { value: 0 }, prefix: `${frameIdx}_`, iconSvgMap, autoTextStyle: this.autoTextStyle });
      if (this.hasTextItems(children)) anyText = true;

      return `
        const f${frameIdx} = figma.createFrame();
        f${frameIdx}.name = ${JSON.stringify(name)};
        f${frameIdx}.resize(${width}, ${height});
        f${frameIdx}.x = ${ownX !== null ? ownX : 'posX'};
        f${frameIdx}.y = ${ownY !== null ? ownY : 'posY'};
        ${rootFill.warnings.map(w => `globalThis.__layoutWarnings.push(${JSON.stringify(w)});`).join('\n        ')}
        f${frameIdx}.cornerRadius = ${rounded};
        ${fillCode.code}
        ${strokeCode.code}
        ${effectsCode}
        ${imageCode}
        f${frameIdx}.layoutMode = '${flex === 'none' || flex === 'stack' || flex === 'free' ? 'NONE' : (flex === 'row' ? 'HORIZONTAL' : 'VERTICAL')}';
        ${flex === 'none' || flex === 'stack' || flex === 'free' ? '' : `${wrap && flex === 'row' ? `f${frameIdx}.layoutWrap = 'WRAP';` : ''}
        f${frameIdx}.itemSpacing = ${itemGap};
        f${frameIdx}.paddingTop = f${frameIdx}.paddingBottom = ${py};
        f${frameIdx}.paddingLeft = f${frameIdx}.paddingRight = ${px};
        f${frameIdx}.primaryAxisAlignItems = '${justifyVal}';
        f${frameIdx}.counterAxisAlignItems = '${alignVal}';
        f${frameIdx}.primaryAxisSizingMode = '${flex === 'col' ? (hugHeight || !hasExplicitHeight ? 'AUTO' : 'FIXED') : (hugWidth || !hasExplicitWidth ? 'AUTO' : 'FIXED')}';
        f${frameIdx}.counterAxisSizingMode = '${flex === 'col' ? (hugWidth || !hasExplicitWidth ? 'AUTO' : 'FIXED') : (hugHeight || !hasExplicitHeight ? 'AUTO' : 'FIXED')}';
        ${wrap && flex === 'row' && wrapGap > 0 ? `f${frameIdx}.counterAxisSpacing = ${wrapGap};` : ''}`}
        ${generateMinMaxCode(`f${frameIdx}`, props)}
        f${frameIdx}.clipsContent = ${clip};
        ${opacity !== null ? `f${frameIdx}.opacity = ${opacity};` : ''}
        ${visible === false ? `f${frameIdx}.visible = false;` : ''}
        ${locked === true ? `f${frameIdx}.locked = true;` : ''}
        ${childCode}
        results.push({ id: f${frameIdx}.id, name: f${frameIdx}.name, width: f${frameIdx}.width, height: f${frameIdx}.height });
        ${vertical ? `posY += f${frameIdx}.height + ${gap};` : `posX += f${frameIdx}.width + ${gap};`}
      `;
    }).join('\n');

    // Text styles cost a style query, so only pay for it when there is text.
    const textStylePrelude = anyText ? TEXT_STYLE_PRELUDE : '';

    return `
      (async function() {
        ${fontLoads}
        ${LAYOUT_WARN_PRELUDE}
        ${textStylePrelude}
        ${varLoadCode}

        // Calculate start position
        let posX = 0, posY = 100;
        const children = figma.currentPage.children;
        if (children.length > 0) {
          let maxRight = 0;
          children.forEach(n => {
            const right = n.x + (n.width || 0);
            if (right > maxRight) maxRight = right;
          });
          posX = Math.round(maxRight + 100);
        }

        const results = [];
        let __currentNode = '';
        ${framesCodes}
        // Surface unresolved var: references back to the caller. Array-prop
        // shorthand is lost by JSON.stringify, so wrap in an object when we
        // have warnings — caller unwraps. Backwards-compatible: plain success
        // still returns the array directly.
        const unresolved = globalThis.__unresolvedVars
          ? [...globalThis.__unresolvedVars].sort() : [];
        globalThis.__unresolvedVars = new Set();
        if (globalThis.__figHugFlush) globalThis.__figHugFlush();
        const layoutWarnings = globalThis.__layoutWarnings || [];
        globalThis.__layoutWarnings = [];
        const textStyles = {
          applied: globalThis.__textStyleApplied || [],
          warnings: globalThis.__textStyleWarnings || [],
        };
        globalThis.__textStyleApplied = [];
        globalThis.__textStyleWarnings = [];
        return (unresolved.length > 0 || layoutWarnings.length > 0 ||
                textStyles.applied.length > 0 || textStyles.warnings.length > 0)
          ? { frames: results, unresolved, layoutWarnings, textStyles }
          : results;
      })()
    `;
  }

  /**
   * Parse JSX-like syntax to Figma Plugin API code
   */
  /**
   * @param {string} jsx
   * @param {{x?:number,y?:number,parent?:string}} [opts] CLI-level placement.
   *   These used to be reachable only through the external `figma-use` binary,
   *   which is why plain `render` had to delegate to it (and inherited a second,
   *   divergent auto-layout implementation). Supporting them here is what lets
   *   every render go through ONE code path.
   */
  async parseJSX(jsx, opts = {}) {
    // Find opening Frame tag
    const openMatch = matchRootFrame(jsx);
    if (!openMatch) {
      throw new Error('Invalid JSX: must start with <Frame>');
    }

    const propsStr = openMatch.propsStr;
    const startIdx = openMatch.end;

    // Find matching closing tag by counting open/close tags
    const children = this.extractContent(jsx.slice(startIdx), 'Frame');

    // Parse props
    const props = this.parseProps(propsStr);

    // Parse children
    const childElements = this.parseChildren(children);

    // Warn if children content exists but nothing was parsed
    const trimmedChildren = children.trim();
    if (trimmedChildren && childElements.length === 0) {
      console.warn('[render] Warning: Frame has content but no elements were parsed.');
      console.warn('[render] Content:', trimmedChildren.slice(0, 200) + (trimmedChildren.length > 200 ? '...' : ''));
      console.warn('[render] Supported elements: <Frame>, <Text>, <Rectangle>, <Rect>, <Image>, <Icon>');
    }

    // Pre-fetch any icon SVGs before code generation
    const iconSvgMap = await this.prefetchIconSvgs(childElements);

    // Generate code
    return this.generateCode(props, childElements, iconSvgMap, opts);
  }

  /**
   * Extract content between matching open/close tags
   */
  extractContent(str, tagName) {
    let depth = 1;
    let i = 0;
    const closeTag = `</${tagName}>`;

    while (i < str.length && depth > 0) {
      const remaining = str.slice(i);

      if (remaining.startsWith(closeTag)) {
        depth--;
        if (depth === 0) {
          return str.slice(0, i);
        }
        i += closeTag.length;
      } else if (remaining.startsWith(`<${tagName} `) || remaining.startsWith(`<${tagName}>`)) {
        // Check if this is a self-closing tag (e.g. <Frame ... />)
        const selfCloseCheck = remaining.match(new RegExp(`^<${tagName}(?:\\s[^>]*?)?\\s*\\/>`));
        if (selfCloseCheck) {
          // Self-closing: skip entirely, don't change depth
          i += selfCloseCheck[0].length;
        } else {
          depth++;
          i++;
        }
      } else {
        i++;
      }
    }

    return str;
  }

  /**
   * Collect all icon names from parsed children tree
   */
  collectIconNames(items) {
    const names = new Set();
    for (const item of items) {
      if (item._type === 'icon' && item.name && item.name.includes(':')) {
        names.add(item.name);
      }
      if (item._children) {
        for (const n of this.collectIconNames(item._children)) {
          names.add(n);
        }
      }
    }
    return names;
  }

  /**
   * Pre-fetch SVGs for all icons in the tree from Iconify API
   * Returns map: { "lucide:chevron-left": "<svg...>" }
   */
  async prefetchIconSvgs(children) {
    const iconNames = this.collectIconNames(children);
    if (iconNames.size === 0) return {};

    const svgMap = {};
    const fetches = [...iconNames].map(async (iconName) => {
      try {
        const [prefix, name] = iconName.split(':');
        const response = await fetch(`https://api.iconify.design/${prefix}/${name}.svg?width=24&height=24`);
        if (response.ok) {
          svgMap[iconName] = await response.text();
        }
      } catch (e) {
        // Silently fall back to placeholder
      }
    });
    await Promise.all(fetches);
    return svgMap;
  }

  /**
   * Validate JSX prop names against the known vocabulary and return warnings
   * for unknown ones, with a suggestion where possible. Pure function, no
   * Figma connection needed — callers print the warnings before rendering.
   * Returns [{ tag, prop, suggestion|null }].
   */
  /**
   * Find `<Text>` whose auto-FILL silently defeats the parent column's `items=`.
   *
   * Parses the same way `parseJSX` does, then hands the tree to a pure decision. Reported from
   * the panel: `items="end"` came back as `counterAxisAlignItems=MAX` with the text still left,
   * because the text was FILLed to the column's full width. Returns [] on anything unparseable —
   * a warning helper must never be the reason a render fails.
   */
  validateTextAlignment(jsx) {
    try {
      const openMatch = matchRootFrame(jsx);
      if (!openMatch) return [];
      const startIdx = openMatch.end;
      const props = this.parseProps(openMatch.propsStr);
      const children = this.parseChildren(this.extractContent(jsx.slice(startIdx), 'Frame'));
      return autoFillDefeatsAlign(props, children);
    } catch {
      return [];
    }
  }

  validateJsxProps(jsx) {
    // The vocabulary lives in src/lib/jsx-props.js so the docs test can read it too.
    const known = KNOWN_PROPS;
    const aliases = PROP_ALIASES;

    const levenshtein = (a, b) => {
      const m = a.length, n = b.length;
      const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
      for (let j = 0; j <= n; j++) d[0][j] = j;
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          d[i][j] = Math.min(
            d[i - 1][j] + 1, d[i][j - 1] + 1,
            d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
          );
        }
      }
      return d[m][n];
    };

    const warnings = [];
    const tagRegex = /<(Frame|Text|Icon|Rect|Rectangle|Ellipse|Circle|Image|Slot|Instance)([^>]*?)\/?>/g;
    let m;
    while ((m = tagRegex.exec(jsx)) !== null) {
      const tag = m[1];
      const valid = known[tag];
      if (!valid) continue;
      const props = this.parseProps(m[2] || '');
      for (const prop of Object.keys(props)) {
        if (valid.includes(prop)) continue;
        let suggestion = aliases[prop] || null;
        if (!suggestion) {
          // Typo detection: closest known prop within edit distance 2
          let best = null, bestDist = 3;
          for (const k of valid) {
            const dist = levenshtein(prop.toLowerCase(), k.toLowerCase());
            if (dist < bestDist) { best = k; bestDist = dist; }
          }
          suggestion = best;
        }
        warnings.push({ tag, prop, suggestion });
      }
    }
    return warnings;
  }

  parseProps(propsStr) {
    const props = {};

    // Match name="value" or name={value}
    const regex = /(\w+)=(?:"([^"]*)"|{([^}]*)})/g;
    let match;

    while ((match = regex.exec(propsStr)) !== null) {
      const key = match[1];
      const value = match[2] !== undefined ? match[2] : match[3];
      props[key] = value;
    }

    // One exit for all fifteen callers: numeric props leave here as numbers,
    // or not at all (see src/lib/jsx-numeric.js).
    return coerceNumericProps(props);
  }

  parseChildren(childrenStr) {
    const children = [];
    const frameRanges = [];

    // First: find all open/close Frame elements (recursive, handles nesting)
    const frameOpenRegex = /<Frame(?:\s+([^>]*?))?>/g;
    let match;

    while ((match = frameOpenRegex.exec(childrenStr)) !== null) {
      // Skip self-closing frames (regex matches /> because > is part of />)
      if (match[0].endsWith('/>')) continue;

      const frameProps = this.parseProps(match[1] || '');
      frameProps._type = 'frame';
      frameProps._index = match.index;

      // Get content between opening and matching closing tag
      const afterOpen = childrenStr.slice(match.index + match[0].length);
      const innerContent = this.extractContent(afterOpen, 'Frame');

      // Calculate full frame length
      const fullLength = match[0].length + innerContent.length + '</Frame>'.length;

      // Recursively parse children of nested frame
      frameProps._children = this.parseChildren(innerContent);
      children.push(frameProps);

      // Mark this range as consumed
      frameRanges.push({ start: match.index, end: match.index + fullLength });

      // Move regex past this frame to avoid re-matching nested frames
      frameOpenRegex.lastIndex = match.index + fullLength;
    }

    // Then: parse self-closing Frame elements NOT inside open/close frames
    const frameSelfCloseRegex = /<Frame(?:\s+([^>]*?))?\s*\/>/g;

    while ((match = frameSelfCloseRegex.exec(childrenStr)) !== null) {
      // Skip if inside an already-consumed open/close frame
      const insideFrame = frameRanges.some(r => match.index >= r.start && match.index < r.end);
      if (insideFrame) continue;

      const frameProps = this.parseProps(match[1] || '');
      frameProps._type = 'frame';
      frameProps._index = match.index;
      frameProps._children = [];
      children.push(frameProps);
      frameRanges.push({ start: match.index, end: match.index + match[0].length });
    }

    // Parse Slot elements (with children) - must be before Text parsing
    // Slots can have children (default content)
    const slotOpenRegex = /<Slot(?:\s+([^>]*?))?>/g;
    while ((match = slotOpenRegex.exec(childrenStr)) !== null) {
      const idx = match.index;
      const insideFrame = frameRanges.some(r => idx >= r.start && idx < r.end);
      if (!insideFrame) {
        const slotProps = this.parseProps(match[1] || '');
        slotProps._type = 'slot';
        slotProps._index = idx;

        // Get content between opening and matching closing tag
        const afterOpen = childrenStr.slice(match.index + match[0].length);
        const innerContent = this.extractContent(afterOpen, 'Slot');
        const fullLength = match[0].length + innerContent.length + '</Slot>'.length;

        // Recursively parse children of slot (default content)
        slotProps._children = this.parseChildren(innerContent);
        children.push(slotProps);

        // Mark this range as consumed (so text/other elements inside are skipped)
        frameRanges.push({ start: idx, end: idx + fullLength });
        slotOpenRegex.lastIndex = idx + fullLength;
      }
    }

    // Parse self-closing Slot elements
    const slotSelfCloseRegex = /<Slot(?:\s+([^/]*?))?\s*\/>/g;
    while ((match = slotSelfCloseRegex.exec(childrenStr)) !== null) {
      const idx = match.index;
      const insideFrame = frameRanges.some(r => idx >= r.start && idx < r.end);
      if (!insideFrame) {
        const slotProps = this.parseProps(match[1] || '');
        slotProps._type = 'slot';
        slotProps._index = idx;
        slotProps._children = [];
        children.push(slotProps);
        // Mark as consumed
        frameRanges.push({ start: idx, end: idx + match[0].length });
      }
    }

    // Parse Text elements, but skip those inside nested Frames/Slots
    // Use (?:\s+([^>]*?))? to allow Text with or without attributes
    const textRegex = /<Text(?:\s+([^>]*?))?>([\s\S]*?)<\/Text>/g;
    while ((match = textRegex.exec(childrenStr)) !== null) {
      const idx = match.index;
      // Check if this text is inside a nested frame
      const insideFrame = frameRanges.some(r => idx >= r.start && idx < r.end);
      if (!insideFrame) {
        const textProps = this.parseProps(match[1] || '');
        textProps._type = 'text';
        const __parsed = this.parseTextRuns(match[2]);
        textProps.content = __parsed.text;
        textProps._runs = __parsed.runs;
        textProps._index = idx;
        children.push(textProps);
      }
    }

    // Parse Rectangle elements (self-closing)
    // Use (?:\s+([^/]*?))? to allow Rect with or without attributes
    const rectRegex = /<(?:Rectangle|Rect)(?:\s+([^/]*?))?\s*\/>/g;
    while ((match = rectRegex.exec(childrenStr)) !== null) {
      const idx = match.index;
      const insideFrame = frameRanges.some(r => idx >= r.start && idx < r.end);
      if (!insideFrame) {
        const rectProps = this.parseProps(match[1] || '');
        rectProps._type = 'rect';
        rectProps._index = idx;
        children.push(rectProps);
      }
    }

    // Parse Ellipse / Circle elements (self-closing). Supports rings, spinners,
    // donut/pie via arc (sweep°), arcStart (start°, 0=3 o'clock) and innerRadius.
    const ellipseRegex = /<(?:Ellipse|Circle)(?:\s+([^/]*?))?\s*\/>/g;
    while ((match = ellipseRegex.exec(childrenStr)) !== null) {
      const idx = match.index;
      const insideFrame = frameRanges.some(r => idx >= r.start && idx < r.end);
      if (!insideFrame) {
        const ellProps = this.parseProps(match[1] || '');
        ellProps._type = 'ellipse';
        ellProps._index = idx;
        children.push(ellProps);
      }
    }

    // Parse Image elements (self-closing) - creates placeholder rectangle
    const imageRegex = /<Image\s+([^/]*)\s*\/>/g;
    while ((match = imageRegex.exec(childrenStr)) !== null) {
      const idx = match.index;
      const insideFrame = frameRanges.some(r => idx >= r.start && idx < r.end);
      if (!insideFrame) {
        const imgProps = this.parseProps(match[1]);
        imgProps._type = 'image';
        imgProps._index = idx;
        children.push(imgProps);
      }
    }

    // Parse Icon elements (self-closing) - creates placeholder
    const iconRegex = /<Icon\s+([^/]*)\s*\/>/g;
    while ((match = iconRegex.exec(childrenStr)) !== null) {
      const idx = match.index;
      const insideFrame = frameRanges.some(r => idx >= r.start && idx < r.end);
      if (!insideFrame) {
        const iconProps = this.parseProps(match[1]);
        iconProps._type = 'icon';
        iconProps._index = idx;
        children.push(iconProps);
      }
    }

    // Parse Instance elements (self-closing) - creates component instance
    const instanceRegex = /<Instance\s+([^/]*)\s*\/>/g;
    while ((match = instanceRegex.exec(childrenStr)) !== null) {
      const idx = match.index;
      const insideFrame = frameRanges.some(r => idx >= r.start && idx < r.end);
      if (!insideFrame) {
        const instProps = this.parseProps(match[1]);
        instProps._type = 'instance';
        instProps._index = idx;
        children.push(instProps);
      }
    }

    // Sort by original position in JSX to maintain order
    children.sort((a, b) => a._index - b._index);

    return children;
  }

  /**
   * Walk a parsed child tree and collect required font styles plus whether
   * any var: reference is used. Shared by single render and batch render so
   * both load the same fonts and detect vars in the same places (including
   * icon colors and slot children, which the old batch collector missed).
   */
  /**
   * Map a JSX weight (+ italic flag) to a Figma font style name.
   * Full scale: thin..black, with italic variants ("Bold Italic").
   */
  weightToStyle(weight, italic) {
    const map = {
      thin: 'Thin', hairline: 'Thin',
      extralight: 'Extra Light', ultralight: 'Extra Light',
      light: 'Light',
      regular: 'Regular', normal: 'Regular',
      medium: 'Medium',
      semibold: 'Semi Bold', demibold: 'Semi Bold',
      bold: 'Bold',
      extrabold: 'Extra Bold', ultrabold: 'Extra Bold',
      black: 'Black', heavy: 'Black',
    };
    const base = map[String(weight || 'regular').toLowerCase()] || 'Regular';
    const isItalic = italic === true || italic === 'true';
    if (isItalic) return base === 'Regular' ? 'Italic' : base + ' Italic';
    return base;
  }

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
    // Trim outer whitespace off the assembled text (padding can live inside a
    // boundary tag, e.g. "<span> alert </span>"), re-mapping run offsets and
    // dropping runs that fall entirely in the trimmed region.
    const lead = (text.match(/^\s+/) || [''])[0].length;
    const trail = (text.match(/\s+$/) || [''])[0].length;
    if (lead || trail) {
      const newLen = text.length - trail;
      text = text.slice(lead, newLen);
      const remapped = [];
      for (const r of runs) {
        const s = Math.max(r.start, lead) - lead;
        const e = Math.min(r.end, newLen) - lead;
        if (e > s) remapped.push({ start: s, end: e, style: r.style });
      }
      runs.length = 0;
      runs.push(...remapped);
    }
    if (runs.length === 0) runs.push({ start: 0, end: 0, style: {} });
    return { text, runs };
  }

  collectFontsAndVarUsage(items) {
    const fontMap = new Map(); // 'family/style' -> { family, style }
    let usesVars = false;
    const check = (v) => { if (this.isVarRef(v)) usesVars = true; };
    const walk = (list) => {
      list.forEach(item => {
        if (item._type === 'text') {
          const family = item.font || 'Inter';
          const style = this.weightToStyle(item.weight, item.italic);
          fontMap.set(family + '/' + style, { family, style });
          check(item.color || '#000000');
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
        } else if (item._type === 'frame' || item._type === 'slot') {
          check(item.bg || item.fill || null);
          if (item.stroke) check(item.stroke);
        } else if (item._type === 'rect' || item._type === 'image' || item._type === 'icon') {
          check(item.bg || item.fill || item.color || item.c || '#e4e4e7');
        } else if (item._type === 'ellipse') {
          check(item.bg || item.fill || null);
          if (item.stroke) check(item.stroke);
        }
        if (item._children) walk(item._children);
      });
    };
    walk(items);
    return { fonts: [...fontMap.values()], usesVars };
  }

  /**
   * Generate the font-loading preamble for render code. Loads every needed
   * (family, style) pair with a session cache, falling back to Inter when a
   * font is missing. Also defines __font(family, style), which the text
   * code-gen uses so fontName always points at a successfully loaded font.
   */
  generateFontLoadCode(fontList) {
    const fonts = fontList && fontList.length ? fontList : [{ family: 'Inter', style: 'Regular' }];
    return `
        if (!globalThis.__loadedFonts) globalThis.__loadedFonts = new Set();
        for (const f of ${JSON.stringify(fonts)}) {
          const key = f.family + '/' + f.style;
          if (globalThis.__loadedFonts.has(key)) continue;
          try {
            await figma.loadFontAsync({ family: f.family, style: f.style });
            globalThis.__loadedFonts.add(key);
          } catch (e) {
            try {
              await figma.loadFontAsync({ family: 'Inter', style: f.style });
              globalThis.__loadedFonts.add('Inter/' + f.style);
            } catch (e2) {
              await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
              globalThis.__loadedFonts.add('Inter/Regular');
            }
          }
        }
        const __font = (family, style) => {
          const lf = globalThis.__loadedFonts;
          if (lf.has(family + '/' + style)) return { family, style };
          if (lf.has('Inter/' + style)) return { family: 'Inter', style };
          return { family: 'Inter', style: 'Regular' };
        };
    `;
  }

  /**
   * Does this tree contain any <Text>? Decides whether the text-style prelude
   * (which queries the file's styles) is worth emitting at all.
   */
  hasTextItems(items) {
    for (const item of items || []) {
      if (item._type === 'text') return true;
      if (item._children && this.hasTextItems(item._children)) return true;
    }
    return false;
  }

  /**
   * Generate Plugin API code for a list of parsed child elements.
   * Shared by the single-render path (generateCode) and the batch path
   * (parseJSXBatch) so both support the same child types and props.
   * ctx: { counter: {value}, prefix: string (el-name prefix, e.g. '0_'),
   *        iconSvgMap: {name: svg} }
   */
  generateChildrenCode(items, parentVar, parentFlex, ctx) {
      return items.map(item => {
        const idx = ctx.prefix + (ctx.counter.value++);
        if (item._type === 'text') {
          const family = item.font || 'Inter';
          const style = this.weightToStyle(item.weight, item.italic);
          const size = item.size || 14;
          const color = item.color || '#000000';
          const fillWidth = item.w === 'fill';
          const numW = (item.w !== undefined && item.w !== 'fill' && item.w !== 'hug' && item.w !== 'auto' && !isNaN(Number(item.w))) ? Number(item.w) : null;
          const textFillCode = this.generateFillCode(color, `el${idx}`);

          // Typography props that used to be in the known-prop list but were
          // never applied (silent footguns): lineHeight, letterSpacing, align.
          // Plus truncation (ellipsis / line-clamp), which Primer leans on.
          // lineHeight/letterSpacing accept a number (px), a "NN%" string, or
          // "auto" (lineHeight only). align maps to textAlignHorizontal.
          const dimUnit = (v) => {
            if (v === 'auto' || v === 'AUTO') return `{ unit: 'AUTO' }`;
            if (typeof v === 'string' && v.trim().endsWith('%')) return `{ value: ${parseFloat(v)}, unit: 'PERCENT' }`;
            return `{ value: ${Number(v)}, unit: 'PIXELS' }`;
          };
          const alignMapT = { left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'JUSTIFIED', start: 'LEFT', end: 'RIGHT' };
          const tAlign = item.align ? alignMapT[String(item.align).toLowerCase()] : null;
          const tLineHeight = item.lineHeight !== undefined ? dimUnit(item.lineHeight) : null;
          const tLetterSpacing = item.letterSpacing !== undefined ? dimUnit(item.letterSpacing) : null;
          const tTruncate = item.truncate === true || item.truncate === 'true';
          const tMaxLines = item.maxLines !== undefined ? parseInt(item.maxLines) : null;

          // Text styles. `textStyle="Heading/H1"` names one explicitly; without
          // it the file's styles are matched against this text's size + weight
          // (see TEXT_STYLE_PRELUDE). Applied after `characters`, so the style
          // wins over the raw props written above it.
          //
          // Nothing typographic may be written AFTERWARDS: measured against a
          // live Figma, assigning fontSize / fontName / lineHeight /
          // letterSpacing silently CLEARS textStyleId. A "CSS-style override"
          // would therefore detach the very style it was overriding. Explicit
          // props that disagree with the style are reported instead — the
          // caller drops one of the two. textAlignHorizontal is safe (it is not
          // part of a text style) and is the one thing still applied after.
          const textStyleName = item.textStyle || item.textstyle || null;
          // Rich text with per-range formatting is deliberate mixed typography;
          // auto-matching a single style onto it would fight the ranges.
          const hasStyledRuns = (item._runs || []).some(r => r.style && Object.keys(r.style).length);
          const autoStyle = ctx.autoTextStyle !== false && !textStyleName && !hasStyledRuns;
          const explicitTypography = {};
          if (item.size !== undefined) explicitTypography.size = Number(size);
          if (item.font !== undefined) explicitTypography.family = family;
          if (item.weight !== undefined || item.italic !== undefined) explicitTypography.weightStyle = style;
          if (item.lineHeight !== undefined) explicitTypography.lineHeight = true;
          if (item.letterSpacing !== undefined) explicitTypography.letterSpacing = true;
          const styleApplyCode = textStyleName
            ? `await globalThis.__applyTextStyle(el${idx}, ${JSON.stringify(String(textStyleName))}, ${JSON.stringify(explicitTypography)});`
            : autoStyle
              ? `await globalThis.__autoTextStyle(el${idx}, ${JSON.stringify({
                  size: Number(size), weightStyle: style, family,
                  familyExplicit: item.font !== undefined,
                })});`
              : '';
          const styleOverrideCode = styleApplyCode && tAlign
            ? `el${idx}.textAlignHorizontal = '${tAlign}';`
            : '';

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

          // Auto-FILL text in column layouts so Safe Mode wraps text correctly.
          const isCol = parentFlex === 'col' || parentFlex === 'column';
          const parentNone = parentFlex === 'none' || parentFlex === 'stack' || parentFlex === 'free';
          const autoFill = isCol && !fillWidth && numW === null;
          return `
        __currentNode = ${JSON.stringify('Text: ' + item.content.substring(0, 30))};
        const el${idx} = figma.createText();
        el${idx}.fontName = __font(${JSON.stringify(family)}, ${JSON.stringify(style)});
        el${idx}.fontSize = ${size};
        ${tLineHeight ? `try { el${idx}.lineHeight = ${tLineHeight}; } catch(e) {}` : ''}
        ${tLetterSpacing ? `try { el${idx}.letterSpacing = ${tLetterSpacing}; } catch(e) {}` : ''}
        ${tAlign ? `el${idx}.textAlignHorizontal = '${tAlign}';` : ''}
        el${idx}.characters = ${JSON.stringify(item.content)};
        ${styleApplyCode}
        ${styleOverrideCode}
        ${textFillCode.code}
        ${runStyleCode ? runStyleCode : ''}
        ${parentVar}.appendChild(el${idx});
        ${numW !== null ? `el${idx}.textAutoResize = 'HEIGHT';
        try { el${idx}.layoutSizingHorizontal = 'FIXED'; } catch(e) {}
        try { el${idx}.resize(${numW}, el${idx}.height); } catch(e) {}` : ''}
        ${fillWidth && !parentNone ? `el${idx}.layoutSizingHorizontal = 'FILL'; el${idx}.textAutoResize = 'HEIGHT';` : ''}
        ${autoFill ? `// Auto-FILL: text in col layout needs FILL for Safe Mode wrapping
        if (${parentVar}.layoutMode === 'VERTICAL' && (${parentVar}.counterAxisSizingMode === 'FIXED' || ${parentVar}.primaryAxisSizingMode === 'FIXED')) {
          try { el${idx}.layoutSizingHorizontal = 'FILL'; el${idx}.textAutoResize = 'HEIGHT'; } catch(e) {}
        }` : ''}
        ${generateMinMaxCode(`el${idx}`, item)}
        ${tTruncate || tMaxLines !== null ? `try { el${idx}.textTruncation = 'ENDING'; } catch(e) {}` : ''}
        ${tMaxLines !== null ? `try { el${idx}.maxLines = ${tMaxLines}; } catch(e) {}` : ''}`;
        } else if (item._type === 'frame') {
          // Nested frame (button, etc.)
          const fName = item.name || 'Nested Frame';
          const fBg = item.bg || item.fill || null;
          const fStroke = item.stroke || null;
          const fStrokeWidth = item.strokeWidth || 1;
          const fStrokeAlign = item.strokeAlign || null;
          const fRounded = item.rounded || item.radius || 0;
          const fFlex = item.flex || DEFAULT_FLEX;
          const fGap = item.gap || 0;
          // Default padding is 0 (only set padding when explicitly specified)
          const fP = item.p !== undefined ? item.p : (item.padding !== undefined ? item.padding : null);
          const fPx = item.px !== undefined ? item.px : (fP !== null ? fP : 0);
          const fPy = item.py !== undefined ? item.py : (fP !== null ? fP : 0);
          // Individual padding overrides (pt, pr, pb, pl)
          const fPt = item.pt !== undefined ? Number(item.pt) : Number(fPy);
          const fPr = item.pr !== undefined ? Number(item.pr) : Number(fPx);
          const fPb = item.pb !== undefined ? Number(item.pb) : Number(fPy);
          const fPl = item.pl !== undefined ? Number(item.pl) : Number(fPx);
          // Sensible alignment defaults (match the root-frame paths, which
          // already default to start): content reads top-left, not centered.
          // EXCEPTION: a row's cross axis stays centered, because vertically
          // centering icon+text in a row/cell is almost always what's wanted.
          // Explicit justify=/items= always win. This fixes the recurring
          // "title/cell content is centered / avatars are staggered" papercut.
          // Resolved by the shared helper so a frame lays out identically
          // whether it is the root or nested ten levels deep.
          // Clip defaults to false for nested frames (overflow="hidden" also sets clip)
          const fClip = item.clip === 'true' || item.clip === true || item.overflow === 'hidden';

          // NEW: wrap, wrapGap, grow, position props
          const fWrap = item.wrap === true || item.wrap === 'true';
          const fWrapGap = Number(item.wrapGap || item.rowGap || item.counterAxisSpacing || 0);
          const fGrow = item.grow !== undefined ? Number(item.grow) : null;
          const fPosition = item.position || 'auto';
          const fAbsoluteX = item.x !== undefined ? Number(item.x) : 0;
          const fAbsoluteY = item.y !== undefined ? Number(item.y) : 0;
          // Generic node-level visuals (same as top-level)
          const fOpacity = item.opacity !== undefined ? Number(item.opacity) : null;
          const fVisible = item.visible === false || item.visible === 'false' ? false : null;
          const fLocked = item.locked === true || item.locked === 'true' ? true : null;
          // Edge-anchored absolute positioning (per directededges Absolute
          // Positioning spec). top/right/bottom/left are edge-relative. If
          // both opposite edges are given → STRETCH (and width/height are
          // ignored, derived from parent). centerOffsetX/Y → CENTER constraint.
          // Strings ending in "%" → SCALE constraint.
          const fTop    = item.top    !== undefined ? item.top    : null;
          const fRight  = item.right  !== undefined ? item.right  : null;
          const fBottom = item.bottom !== undefined ? item.bottom : null;
          const fLeft   = item.left   !== undefined ? item.left   : null;
          const fCenterOffsetX = item.centerOffsetX !== undefined ? Number(item.centerOffsetX) : null;
          const fCenterOffsetY = item.centerOffsetY !== undefined ? Number(item.centerOffsetY) : null;
          const hasEdgeAttrs = fTop !== null || fRight !== null || fBottom !== null || fLeft !== null
                              || fCenterOffsetX !== null || fCenterOffsetY !== null;
          // If any edge attr is set, position defaults to absolute.
          const effectivePosition = hasEdgeAttrs ? 'absolute' : fPosition;

          // Support w="fill" / "hug" keywords on nested frames. fill = stretch
          // to fill the auto-layout cross-axis; hug = size to children.
          // These are NOT numeric — never interpolate into resize() directly.
          const fillWidth = item.w === 'fill';
          const fillHeight = item.h === 'fill';
          const hugWidth = item.w === 'hug';
          const hugHeight = item.h === 'hug';

          // Percentage sizing: w="60%" / h="50%" resolves to a FIXED px size =
          // that fraction of the PARENT's resolved dimension at append time
          // (auto-layout has no native %, so we compute it). Without this the
          // "60%" string used to leak into resize() and produce broken JS.
          const pctOf = v => (typeof v === 'string' && /^\d+(\.\d+)?%$/.test(v)) ? parseFloat(v) / 100 : null;
          const pctW = pctOf(item.w) !== null ? pctOf(item.w) : pctOf(item.width);
          const pctH = pctOf(item.h) !== null ? pctOf(item.h) : pctOf(item.height);

          // HUG by default, FIXED only if explicit numeric size given.
          // Percentages and the fill/hug keywords are NOT numeric — never let
          // them reach resize() as raw strings.
          const isNumeric = v => v !== undefined && v !== 'fill' && v !== 'hug' && pctOf(v) === null;
          const numericW = isNumeric(item.w) ? item.w : isNumeric(item.width) ? item.width : undefined;
          const numericH = isNumeric(item.h) ? item.h : isNumeric(item.height) ? item.height : undefined;
          const hasWidth = numericW !== undefined;
          const hasHeight = numericH !== undefined;
          const fWidth = numericW !== undefined ? numericW : 100;
          const fHeight = numericH !== undefined ? numericH : 40;

          const { alignVal: fAlignVal, justifyVal: fJustifyVal } = resolveAlign(fFlex, item);

          const nestedChildren = item._children ? this.generateChildrenCode(item._children, `el${idx}`, fFlex, ctx) : '';
          const frameFillCode = fBg ? this.generateFillCode(fBg, `el${idx}`) : { code: `el${idx}.fills = [];`, usesVars: false };
          const frameStrokeCode = fStroke ? this.generateStrokeCode(fStroke, `el${idx}`, fStrokeWidth, fStrokeAlign) : { code: '' };
          const frameEffectsCode = this.generateEffectsCode(item, `el${idx}`);

          // `stretch={true}` fills the CROSS axis of the parent (vertical when
          // the parent is a row, horizontal when it's a col). This was a known
          // prop that previously did nothing — a silent footgun where dividers
          // never filled their parent's height.
          const isStretch = item.stretch === true || item.stretch === 'true';
          const crossIsV = parentFlex === 'row';   // cross axis of a row = vertical
          const crossIsH = parentFlex === 'col';   // cross axis of a col = horizontal

          // Thin-divider auto-fill guard: a 1–2px-thin child (a divider/rule)
          // whose long (cross) axis is left UNSET would otherwise default to a
          // 100px frame and inflate the whole parent ("looks zu hoch"). When the
          // short axis is a small fixed number and the cross axis is unspecified,
          // auto-fill the cross axis so the rule spans the parent instead.
          const thinW = hasWidth && Number(numericW) <= 2 && !hasHeight && !fillHeight && !hugHeight;
          const thinH = hasHeight && Number(numericH) <= 2 && !hasWidth && !fillWidth && !hugWidth;
          const autoFillV = thinW && crossIsV;
          const autoFillH = thinH && crossIsH;

          // Determine sizing: FILL, FIXED, or HUG for each axis. An explicit
          // `hug` keyword forces HUG regardless of whether a number was given.
          // A percentage forces FIXED (px resolved from the parent at runtime).
          const wantFillH = fillWidth || (fGrow !== null && parentFlex === 'row') || (isStretch && crossIsH) || autoFillH;
          const wantFillV = fillHeight || (fGrow !== null && parentFlex === 'col') || (isStretch && crossIsV) || autoFillV;
          const hSizing = pctW !== null ? 'FIXED' : wantFillH ? 'FILL' : hugWidth ? 'HUG' : (hasWidth ? 'FIXED' : 'HUG');
          const vSizing = pctH !== null ? 'FIXED' : wantFillV ? 'FILL' : hugHeight ? 'HUG' : (hasHeight ? 'FIXED' : 'HUG');

          // Initial resize: for an axis that will FILL, seed it at 1px (not the
          // 100px default) so the parent hugs to its REAL content before FILL is
          // applied. Otherwise a divider's 100px default determines the hug and
          // FILL can't shrink it back (the "zu hoch" footgun).
          //
          // That seed is for DIVIDERS specifically — a rule spanning its parent,
          // whose own size must not influence the hug. Applying it to every FILL
          // child was too broad: an ordinary `w="fill"` child in a parent that
          // hugs width has nothing else establishing that axis, so the 1px seed
          // became the answer and the child collapsed to 1px and disappeared.
          // Ordinary fill children keep the normal seed; `__figHugWarn` below
          // reports the hug/fill conflict either way.
          const isDividerFillH = wantFillH && ((isStretch && crossIsH) || autoFillH);
          const isDividerFillV = wantFillV && ((isStretch && crossIsV) || autoFillV);
          const resizeW = hasWidth ? fWidth : (isDividerFillH ? 1 : 100);
          const resizeH = hasHeight ? fHeight : (isDividerFillV ? 1 : 100);

          // flex="none" (aliases: stack/free) → no auto-layout. Children keep
          // their own x/y, so they OVERLAP (z-stack): spinners (ring+arc),
          // badges on avatars, layered graphics. Auto-layout-only props (gap,
          // padding, align, sizing) must be skipped or Figma throws on NONE.
          const isNone = fFlex === 'none' || fFlex === 'stack' || fFlex === 'free';
          const parentIsNone = parentFlex === 'none' || parentFlex === 'stack' || parentFlex === 'free';
          return `
        __currentNode = ${JSON.stringify('Frame: ' + fName)};
        const el${idx} = figma.createFrame();
        el${idx}.name = ${JSON.stringify(fName)};
        el${idx}.layoutMode = '${isNone ? 'NONE' : (fFlex === 'row' ? 'HORIZONTAL' : 'VERTICAL')}';
        ${!isNone && fWrap && fFlex === 'row' ? `el${idx}.layoutWrap = 'WRAP';` : ''}
        ${hasWidth || hasHeight || (!isNone && (wantFillH || wantFillV)) ? `el${idx}.resize(${resizeW}, ${resizeH});` : ''}
        ${isNone ? '' : `el${idx}.itemSpacing = ${fGap};
        el${idx}.paddingTop = ${fPt};
        el${idx}.paddingBottom = ${fPb};
        el${idx}.paddingLeft = ${fPl};
        el${idx}.paddingRight = ${fPr};`}
        el${idx}.cornerRadius = ${fRounded};
        ${frameFillCode.code}
        ${frameStrokeCode.code}
        ${frameEffectsCode}
        ${isNone ? '' : `el${idx}.primaryAxisAlignItems = '${fJustifyVal}';
        el${idx}.counterAxisAlignItems = '${fAlignVal}';`}
        el${idx}.clipsContent = ${fClip};
        ${fOpacity !== null ? `el${idx}.opacity = ${fOpacity};` : ''}
        ${fVisible === false ? `el${idx}.visible = false;` : ''}
        ${fLocked === true ? `el${idx}.locked = true;` : ''}
        ${parentVar}.appendChild(el${idx});
        ${parentIsNone ? '' : `el${idx}.layoutSizingHorizontal = '${hSizing}';
        el${idx}.layoutSizingVertical = '${vSizing}';`}
        ${!parentIsNone && wantFillH ? `globalThis.__figHugWarn(el${idx}, 'H');` : ''}
        ${!parentIsNone && wantFillV ? `globalThis.__figHugWarn(el${idx}, 'V');` : ''}
        ${generateMinMaxCode(`el${idx}`, item)}
        ${pctW !== null || pctH !== null ? `try {
          const _pp = el${idx}.parent;
          if (_pp && 'width' in _pp) {
            ${pctW !== null ? `el${idx}.resize(Math.max(1, Math.round(_pp.width * ${pctW})), el${idx}.height);` : ''}
            ${pctH !== null ? `el${idx}.resize(el${idx}.width, Math.max(1, Math.round(_pp.height * ${pctH})));` : ''}
          }
        } catch (e) {}` : ''}
        ${nestedChildren}
        ${fWrap && fFlex === 'row' && fWrapGap > 0 ? `el${idx}.counterAxisSpacing = ${fWrapGap};` : ''}
        ${parentIsNone ? `
          ${item.x !== undefined ? `el${idx}.x = ${fAbsoluteX};` : ''}
          ${item.y !== undefined ? `el${idx}.y = ${fAbsoluteY};` : ''}
        ` : effectivePosition === 'absolute' ? `
          el${idx}.layoutPositioning = 'ABSOLUTE';
          (function applyEdges() {
            const pp = el${idx}.parent;
            if (!pp || !('width' in pp)) {
              el${idx}.x = ${fAbsoluteX}; el${idx}.y = ${fAbsoluteY};
              return;
            }
            const pw = pp.width, ph = pp.height;
            // Resolve edge values: numbers are px, strings ending in "%" are proportional
            const resolve = (v, total) => {
              if (v == null) return null;
              if (typeof v === 'string' && v.endsWith('%')) return parseFloat(v) / 100 * total;
              return Number(v);
            };
            const top    = ${JSON.stringify(fTop)};
            const right  = ${JSON.stringify(fRight)};
            const bottom = ${JSON.stringify(fBottom)};
            const left   = ${JSON.stringify(fLeft)};
            const coX    = ${JSON.stringify(fCenterOffsetX)};
            const coY    = ${JSON.stringify(fCenterOffsetY)};
            const c = { horizontal: el${idx}.constraints.horizontal, vertical: el${idx}.constraints.vertical };
            const isScale = (v) => typeof v === 'string' && v.endsWith('%');
            // Horizontal axis
            if (left != null && right != null) {
              const l = resolve(left, pw), r = resolve(right, pw);
              el${idx}.x = l;
              el${idx}.resize(Math.max(1, pw - l - r), el${idx}.height);
              c.horizontal = (isScale(left) || isScale(right)) ? 'SCALE' : 'STRETCH';
            } else if (right != null) {
              const r = resolve(right, pw);
              el${idx}.x = pw - el${idx}.width - r;
              c.horizontal = 'MAX';
            } else if (left != null) {
              el${idx}.x = resolve(left, pw);
              c.horizontal = 'MIN';
            } else if (coX != null) {
              el${idx}.x = (pw - el${idx}.width) / 2 + coX;
              c.horizontal = 'CENTER';
            } else if (${fAbsoluteX} !== 0 || ${fAbsoluteX === 0 && fTop === null && fBottom === null && fLeft === null && fRight === null && fCenterOffsetX === null}) {
              el${idx}.x = ${fAbsoluteX};
            }
            // Vertical axis (same patterns)
            if (top != null && bottom != null) {
              const t = resolve(top, ph), b = resolve(bottom, ph);
              el${idx}.y = t;
              el${idx}.resize(el${idx}.width, Math.max(1, ph - t - b));
              c.vertical = (isScale(top) || isScale(bottom)) ? 'SCALE' : 'STRETCH';
            } else if (bottom != null) {
              const b = resolve(bottom, ph);
              el${idx}.y = ph - el${idx}.height - b;
              c.vertical = 'MAX';
            } else if (top != null) {
              el${idx}.y = resolve(top, ph);
              c.vertical = 'MIN';
            } else if (coY != null) {
              el${idx}.y = (ph - el${idx}.height) / 2 + coY;
              c.vertical = 'CENTER';
            } else if (${fAbsoluteY} !== 0 || ${fAbsoluteY === 0 && fTop === null && fBottom === null && fLeft === null && fRight === null && fCenterOffsetY === null}) {
              el${idx}.y = ${fAbsoluteY};
            }
            el${idx}.constraints = c;
          })();` : ''}`;
        } else if (item._type === 'rect') {
          // Rectangle element
          const rectParentNone = parentFlex === 'none' || parentFlex === 'stack' || parentFlex === 'free';
          const rectSizing = resolveLeafSizing({
            // `|| undefined` keeps the old falsy-means-default behaviour.
            w: (item.w || item.width) || undefined, h: (item.h || item.height) || undefined,
            defaultW: 100, defaultH: 100, parentIsNone: rectParentNone,
          });
          const rWidth = rectSizing.resizeW;
          const rHeight = rectSizing.resizeH;
          const rBg = item.bg || item.fill || '#e4e4e7';
          const rRounded = item.rounded || item.radius || 0;
          const rName = item.name || 'Rectangle';
          const rectFillCode = this.generateFillCode(rBg, `el${idx}`);

          return `
        const el${idx} = figma.createRectangle();
        el${idx}.name = ${JSON.stringify(rName)};
        el${idx}.resize(${rWidth}, ${rHeight});
        el${idx}.cornerRadius = ${rRounded};
        ${rectFillCode.code}
        ${parentVar}.appendChild(el${idx});
        ${this.genLeafFillCode(rectSizing, `el${idx}`)}
        ${this.genCommonNodeProps(item, `el${idx}`, rectParentNone)}`;
        } else if (item._type === 'ellipse') {
          // Ellipse / Circle. arc (sweep degrees) + arcStart (start degrees,
          // 0 = 3 o'clock, clockwise) + innerRadius (0–1) make rings, spinners,
          // donut and pie slices. No arc/innerRadius = a plain filled ellipse.
          const ellParentNone = parentFlex === 'none' || parentFlex === 'stack' || parentFlex === 'free';
          const ellSizing = resolveLeafSizing({
            w: (item.w || item.width) || undefined, h: (item.h || item.height) || undefined,
            defaultW: 100, defaultH: (item.w || item.width) === 'fill' ? 100 : ((item.w || item.width) || 100),
            parentIsNone: ellParentNone,
          });
          const eW = ellSizing.resizeW;
          const eH = ellSizing.resizeH;
          const eName = item.name || 'Ellipse';
          const eBg = item.bg || item.fill || null;
          const eStroke = item.stroke || null;
          const eStrokeWidth = item.strokeWidth || 1;
          const eStrokeAlign = item.strokeAlign || null;
          const inner = item.innerRadius !== undefined ? Math.max(0, Math.min(1, Number(item.innerRadius))) : 0;
          const hasArc = item.arc !== undefined || item.arcStart !== undefined || inner > 0;
          const startDeg = item.arcStart !== undefined ? Number(item.arcStart) : 0;
          const sweepDeg = item.arc !== undefined ? Number(item.arc) : 360;
          const startRad = startDeg * Math.PI / 180;
          const endRad = (startDeg + sweepDeg) * Math.PI / 180;
          const ellFillCode = eBg ? this.generateFillCode(eBg, `el${idx}`) : { code: '' };
          const ellStrokeCode = eStroke ? this.generateStrokeCode(eStroke, `el${idx}`, eStrokeWidth, eStrokeAlign) : { code: '' };
          return `
        const el${idx} = figma.createEllipse();
        el${idx}.name = ${JSON.stringify(eName)};
        el${idx}.resize(${eW}, ${eH});
        ${ellFillCode.code}
        ${ellStrokeCode.code}
        ${hasArc ? `try { el${idx}.arcData = { startingAngle: ${startRad}, endingAngle: ${endRad}, innerRadius: ${inner} }; } catch(e) {}` : ''}
        ${parentVar}.appendChild(el${idx});
        ${this.genLeafFillCode(ellSizing, `el${idx}`)}
        ${this.genCommonNodeProps(item, `el${idx}`, ellParentNone)}`;
        } else if (item._type === 'image') {
          // Image placeholder (gray rectangle with image icon concept)
          const imgParentNone = parentFlex === 'none' || parentFlex === 'stack' || parentFlex === 'free';
          const imgSizing = resolveLeafSizing({
            w: (item.w || item.width) || undefined, h: (item.h || item.height) || undefined,
            defaultW: 200, defaultH: 150, parentIsNone: imgParentNone,
          });
          const iWidth = imgSizing.resizeW;
          const iHeight = imgSizing.resizeH;
          const iBg = item.bg || '#f4f4f5';
          const iRounded = item.rounded || item.radius || 8;
          const iName = item.name || 'Image';
          const imgFillCode = this.generateFillCode(iBg, `el${idx}`);

          return `
        const el${idx} = figma.createRectangle();
        el${idx}.name = ${JSON.stringify(iName)};
        el${idx}.resize(${iWidth}, ${iHeight});
        el${idx}.cornerRadius = ${iRounded};
        ${imgFillCode.code}
        ${parentVar}.appendChild(el${idx});
        ${this.genLeafFillCode(imgSizing, `el${idx}`)}
        ${this.genCommonNodeProps(item, `el${idx}`, imgParentNone)}`;
        } else if (item._type === 'icon') {
          const icSize = item.size || item.s || 24;
          const icBg = item.color || item.c || '#71717a';
          const icName = item.name || 'Icon';
          const svgData = ctx.iconSvgMap[icName];

          if (svgData) {
            // Real SVG icon from Iconify
            // IMPORTANT: createNodeFromSvg creates a Frame wrapper. We must:
            // 1. Clear fills on the wrapper frame (otherwise it shows as a filled square)
            // 2. Only colorize the vector children inside, not the wrapper
            const colorCode = icBg.startsWith('var:') ? '' : (() => {
              const rgb = this.hexToRgb(icBg);
              return rgb ? `
            function colorize${idx}(n) {
              if (n.fills && n.fills.length > 0) n.fills = [{type:'SOLID',color:{r:${rgb.r},g:${rgb.g},b:${rgb.b}}}];
              if (n.strokes && n.strokes.length > 0) n.strokes = [{type:'SOLID',color:{r:${rgb.r},g:${rgb.g},b:${rgb.b}}}];
              if (n.children) n.children.forEach(colorize${idx});
            }
            if (el${idx}.children) el${idx}.children.forEach(colorize${idx});` : '';
            })();

            // Variable color binding for icons
            const varColorCode = icBg.startsWith('var:') ? (() => {
              const varName = icBg.slice(4);
              return `
            { const __v = lookupVar(${JSON.stringify(varName)}); if (__v) {
              function colorizeVar${idx}(n) {
                if (n.fills && n.fills.length > 0) n.fills = [boundFill(__v)];
                if (n.strokes && n.strokes.length > 0) n.strokes = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0.5,g:0.5,b:0.5}},'color',__v)];
                if (n.children) n.children.forEach(colorizeVar${idx});
              }
              if (el${idx}.children) el${idx}.children.forEach(colorizeVar${idx});
            } }`;
            })() : '';

            return `
        const el${idx} = figma.createNodeFromSvg(${JSON.stringify(svgData)});
        el${idx}.name = ${JSON.stringify(icName)};
        el${idx}.fills = [];
        el${idx}.resize(${icSize}, ${icSize});
        ${colorCode}${varColorCode}
        ${parentVar}.appendChild(el${idx});`;
          } else {
            // Fallback: placeholder rectangle
            const iconFillCode = this.generateFillCode(icBg, `el${idx}`);
            return `
        const el${idx} = figma.createRectangle();
        el${idx}.name = ${JSON.stringify(icName)};
        el${idx}.resize(${icSize}, ${icSize});
        el${idx}.cornerRadius = ${Math.round(icSize / 4)};
        ${iconFillCode.code}
        ${parentVar}.appendChild(el${idx});`;
          }
        } else if (item._type === 'instance') {
          // Component instance
          const compId = item.component || item.id;
          const compName = item.name;

          if (compId) {
            // Create instance by component ID
            return `
        const comp${idx} = await figma.getNodeByIdAsync(${JSON.stringify(compId)});
        if (comp${idx} && comp${idx}.type === 'COMPONENT') {
          const el${idx} = comp${idx}.createInstance();
          ${parentVar}.appendChild(el${idx});
        }`;
          } else if (compName) {
            // Find component by name and create instance
            return `
        const comp${idx} = figma.currentPage.findOne(n => n.type === 'COMPONENT' && n.name === ${JSON.stringify(compName)});
        if (comp${idx}) {
          const el${idx} = comp${idx}.createInstance();
          ${parentVar}.appendChild(el${idx});
        }`;
          }
          return '';
        } else if (item._type === 'slot') {
          // Slot element - creates slot inside component
          // NOTE: createSlot only works when parent is a component
          const slotName = item.name || 'Slot';
          const slotFlex = item.flex || 'col';
          const slotGap = item.gap || 0;
          const slotP = item.p !== undefined ? item.p : (item.padding !== undefined ? item.padding : null);
          const slotPx = item.px !== undefined ? item.px : (slotP !== null ? slotP : 0);
          const slotPy = item.py !== undefined ? item.py : (slotP !== null ? slotP : 0);
          const slotBg = item.bg || item.fill || null;
          const slotWidth = item.w || item.width;
          const slotHeight = item.h || item.height;
          const fillWidth = item.w === 'fill';
          const fillHeight = item.h === 'fill';

          const nestedChildren = item._children ? this.generateChildrenCode(item._children, `slot${idx}`, slotFlex, ctx) : '';
          const slotFillCode = slotBg ? this.generateFillCode(slotBg, `slot${idx}`) : { code: '' };

          return `
        // Create slot (only works if parent is a component)
        let slot${idx} = null;
        if (${parentVar}.type === 'COMPONENT' || ${parentVar}.type === 'COMPONENT_SET') {
          slot${idx} = ${parentVar}.createSlot(${JSON.stringify(slotName)});
        } else {
          // Fall back to regular frame if parent is not a component
          slot${idx} = figma.createFrame();
          slot${idx}.name = ${JSON.stringify(slotName)};
          ${parentVar}.appendChild(slot${idx});
        }
        slot${idx}.layoutMode = '${slotFlex === 'row' ? 'HORIZONTAL' : 'VERTICAL'}';
        slot${idx}.itemSpacing = ${slotGap};
        slot${idx}.paddingTop = ${slotPy};
        slot${idx}.paddingBottom = ${slotPy};
        slot${idx}.paddingLeft = ${slotPx};
        slot${idx}.paddingRight = ${slotPx};
        ${slotWidth && !fillWidth ? `slot${idx}.resize(${slotWidth}, ${slotHeight || 100});` : ''}
        ${fillWidth ? `slot${idx}.layoutSizingHorizontal = 'FILL';` : ''}
        ${fillHeight ? `slot${idx}.layoutSizingVertical = 'FILL';` : ''}
        ${slotFillCode.code}
        ${nestedChildren}`;
        }
        return '';
      }).join('\n');
  }

  generateCode(props, children, iconSvgMap = {}, opts = {}) {
    const name = props.name || 'Frame';
    const rawWidth = props.w || props.width;
    const rawHeight = props.h || props.height;
    // Support w="fill" / w="hug" (and same for h) on the root frame. Both
    // are sizing keywords — never interpolate raw into resize() or you get
    // ReferenceError: 'fill' / 'hug' is not defined. (NB: don't shadow the
    // existing `hugWidth/Height` from the `hug` prop below — that one is set
    // via `hug="w"` / `hug="h"` / `hug="both"` and resolves the same flag.)
    const fillWidth = rawWidth === 'fill';
    const fillHeight = rawHeight === 'fill';
    const wHug = rawWidth === 'hug';
    const hHug = rawHeight === 'hug';
    const isNumeric = v => v !== undefined && v !== 'fill' && v !== 'hug';
    const numericWidth = isNumeric(rawWidth) ? rawWidth : undefined;
    const numericHeight = isNumeric(rawHeight) ? rawHeight : undefined;
    const hasExplicitWidth = numericWidth !== undefined;
    const hasExplicitHeight = numericHeight !== undefined;
    const width = numericWidth !== undefined ? numericWidth : 320;
    const height = numericHeight !== undefined ? numericHeight : 200;
    const bg = props.bg || props.fill || null;
    const stroke = props.stroke || null;
    const strokeWidth = props.strokeWidth || 1;
    const strokeAlignProp = props.strokeAlign || null;
    const rounded = props.rounded || props.radius || 0;
    const flex = props.flex || DEFAULT_FLEX;
    const gap = props.gap || 0;
    const p = props.p || props.padding || 0;
    const px = props.px || p;
    const py = props.py || p;
    // CLI-supplied -x/-y win over JSX props; `--no-smart-position` reaches us
    // as an explicit x so the frame lands exactly where the caller asked.
    const cliX = opts.x !== undefined && opts.x !== null ? Number(opts.x) : undefined;
    const cliY = opts.y !== undefined && opts.y !== null ? Number(opts.y) : undefined;
    const useSmartPos = cliX === undefined && props.x === undefined;
    const explicitX = cliX !== undefined ? cliX : (props.x || 0);
    const y = cliY !== undefined ? cliY : (props.y || 0);
    // New: clip defaults to false (don't clip auto-layout overflow). overflow="hidden" also sets clip.
    const clip = props.clip === 'true' || props.clip === true || props.overflow === 'hidden';
    // Generic node-level visuals — apply on the root frame too (single-render path)
    const opacity = props.opacity !== undefined ? Number(props.opacity) : null;
    const visible = props.visible === false || props.visible === 'false' ? false : null;
    const locked = props.locked === true || props.locked === 'true' ? true : null;
    // New: hug for auto-sizing (hug="both" | "w" | "h" | "width" | "height")
    // OR the keyword form w="hug" / h="hug" set wHug/hHug above.
    const hug = props.hug || '';
    const hugWidth = wHug || hug === 'both' || hug === 'w' || hug === 'width';
    const hugHeight = hHug || hug === 'both' || hug === 'h' || hug === 'height';
    // New: wrap and wrapGap for horizontal layouts
    const wrap = props.wrap === true || props.wrap === 'true';
    const wrapGap = Number(props.wrapGap || props.rowGap || props.counterAxisSpacing || 0);

    // Track variable usage for fast binding
    let usesVars = false;
    const checkVarUsage = (value) => {
      if (this.isVarRef(value)) usesVars = true;
    };

    // Check root frame for var usage
    checkVarUsage(bg);
    if (stroke) checkVarUsage(stroke);

    // Collect all fonts and check variable usage recursively
    const collected = this.collectFontsAndVarUsage(children);
    if (collected.usesVars) usesVars = true;

    const childCode = this.generateChildrenCode(children, 'frame', flex, { counter: { value: 0 }, prefix: '', iconSvgMap, autoTextStyle: this.autoTextStyle });

    const { alignVal, justifyVal } = resolveAlign(flex, props);

    // Smart positioning code
    const smartPosCode = useSmartPos ? `
        let smartX = 0;
        const children = figma.currentPage.children;
        if (children.length > 0) {
          let maxRight = 0;
          children.forEach(n => {
            const right = n.x + (n.width || 0);
            if (right > maxRight) maxRight = right;
          });
          smartX = Math.round(maxRight + 100);
        }
    ` : `const smartX = ${explicitX};`;

    // Generate fill/stroke code for root frame
    const rootFillCode = this.generateFillCode(bg, 'frame');
    const rootStrokeCode = stroke ? this.generateStrokeCode(stroke, 'frame', strokeWidth, strokeAlignProp) : { code: '', usesVars: false };
    const rootEffectsCode = this.generateEffectsCode(props, 'frame');
    const rootImageCode = props.image ? this.generateImageFillCode(props.image, 'frame', props.imageScale) : '';

    // Variable loading code with caching (only if any vars used)
    const colFilter2 = this.collectionFilter;
    const varLoadCode = usesVars ? `
        if (!globalThis.__varsCache || globalThis.__varsCacheFilter !== ${JSON.stringify(colFilter2)} ||
            Date.now() - (globalThis.__varsCacheTime || 0) > 30000) {
          const [collections, allVars] = await Promise.all([
            figma.variables.getLocalVariableCollectionsAsync(),
            figma.variables.getLocalVariablesAsync(),
          ]);
          const filter = ${JSON.stringify(colFilter2)};
          const shadcnColIds = new Set(
            collections.filter(c => c.name.startsWith('shadcn')).map(c => c.id)
          );
          let scopedColIds = null;
          if (filter) {
            const fl = filter.toLowerCase();
            scopedColIds = new Set(
              collections.filter(c => c.name.toLowerCase() === fl || c.name.toLowerCase().includes(fl))
                .map(c => c.id)
            );
          }
          globalThis.__varsCache = {};
          // Register full name + tail-after-slash alias, so a variable named
          // "colors/primary" resolves as either var:primary or var:colors/primary.
          const register = (v) => {
            if (!globalThis.__varsCache[v.name]) globalThis.__varsCache[v.name] = v;
            const slash = v.name.lastIndexOf('/');
            if (slash >= 0) {
              const tail = v.name.slice(slash + 1);
              if (tail && !globalThis.__varsCache[tail]) globalThis.__varsCache[tail] = v;
            }
          };
          if (scopedColIds) {
            for (const v of allVars) if (scopedColIds.has(v.variableCollectionId)) register(v);
          } else {
            for (const v of allVars) if (shadcnColIds.has(v.variableCollectionId)) register(v);
            for (const v of allVars) if (!shadcnColIds.has(v.variableCollectionId)) register(v);
          }
          globalThis.__varsByCollection = {};
          for (const v of allVars) {
            const col = collections.find(c => c.id === v.variableCollectionId);
            if (!col) continue;
            const colKey = col.name.toLowerCase() + ':';
            globalThis.__varsByCollection[colKey + v.name] = v;
            const slash = v.name.lastIndexOf('/');
            if (slash >= 0) {
              const tail = v.name.slice(slash + 1);
              if (tail && !globalThis.__varsByCollection[colKey + tail]) globalThis.__varsByCollection[colKey + tail] = v;
            }
          }
          globalThis.__varsCacheTime = Date.now();
          globalThis.__varsCacheFilter = filter;
        }
        const vars = globalThis.__varsCache;
        const varsByCollection = globalThis.__varsByCollection || {};
        const lookupVar = (key) => {
          if (key.includes(':')) {
            const [colName, varName] = key.split(':', 2);
            return varsByCollection[colName.toLowerCase() + ':' + varName] || vars[varName];
          }
          return vars[key];
        };
        globalThis.__unresolvedVars = globalThis.__unresolvedVars || new Set();
        const __varDefaults = ${JSON.stringify(SEMANTIC_VAR_DEFAULTS)};
        const __defaultColor = (requestedKey) => {
          if (!requestedKey) return null;
          let k = String(requestedKey);
          const c = k.lastIndexOf(':'); if (c >= 0) k = k.slice(c + 1);
          const s = k.lastIndexOf('/'); if (s >= 0) k = k.slice(s + 1);
          return __varDefaults[k] || null;
        };
        const boundFill = (variable, requestedKey) => {
          if (!variable) {
            if (requestedKey) globalThis.__unresolvedVars.add(requestedKey);
            // No variable loaded — use the semantic token's real default color
            // so the component stays VISIBLE instead of grey-on-grey.
            return { type: 'SOLID', color: __defaultColor(requestedKey) || { r: 0.5, g: 0.5, b: 0.5 } };
          }
          return figma.variables.setBoundVariableForPaint(
            { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }, 'color', variable
          );
        };
    ` : '';

    // Font loading with caching (shared emitter, includes __font helper)
    const fontLoadCode = this.generateFontLoadCode(collected.fonts);

    // w/h="fill" on the ROOT frame: only meaningful inside an auto-layout
    // parent, and only settable after appendChild (which runs last, below).
    const rootFill = resolveRootFill({ fillWidth, fillHeight, hasParent: !!opts.parent, name });

    // Text styles cost a style query, so only pay for it when there is text.
    const textStylePrelude = this.hasTextItems(children) ? TEXT_STYLE_PRELUDE : '';

    return `
      (async function() {
        ${fontLoadCode}
        ${LAYOUT_WARN_PRELUDE}
        ${textStylePrelude}
        ${varLoadCode}
        ${smartPosCode}

        let __currentNode = 'root';
        // Declared OUTSIDE the try on purpose: the catch below cleans the frame
        // up, and a const inside the try is not in scope there. That shadowing
        // turned every render failure into "ReferenceError: frame is not
        // defined" and left the half-built frame on the canvas.
        let frame;
        try {
        frame = figma.createFrame();
        __currentNode = ${JSON.stringify(name)};
        frame.name = ${JSON.stringify(name)};
        frame.resize(${width}, ${height});
        frame.x = smartX;
        frame.y = ${y};
        frame.cornerRadius = ${rounded};
        ${rootFillCode.code}
        ${rootStrokeCode.code}
        ${rootEffectsCode}
        ${rootImageCode}
        frame.layoutMode = '${flex === 'none' || flex === 'stack' || flex === 'free' ? 'NONE' : (flex === 'row' ? 'HORIZONTAL' : 'VERTICAL')}';
        ${flex === 'none' || flex === 'stack' || flex === 'free' ? '' : `${wrap && flex === 'row' ? `frame.layoutWrap = 'WRAP';` : ''}
        frame.itemSpacing = ${gap};
        frame.paddingTop = ${py};
        frame.paddingBottom = ${py};
        frame.paddingLeft = ${px};
        frame.paddingRight = ${px};
        frame.primaryAxisAlignItems = '${justifyVal}';
        frame.counterAxisAlignItems = '${alignVal}';
        frame.primaryAxisSizingMode = '${flex === 'col' ? (hugHeight || fillHeight || !hasExplicitHeight ? 'AUTO' : 'FIXED') : (hugWidth || fillWidth || !hasExplicitWidth ? 'AUTO' : 'FIXED')}';
        frame.counterAxisSizingMode = '${flex === 'col' ? (hugWidth || fillWidth || !hasExplicitWidth ? 'AUTO' : 'FIXED') : (hugHeight || fillHeight || !hasExplicitHeight ? 'AUTO' : 'FIXED')}';
        ${wrap && flex === 'row' && wrapGap > 0 ? `frame.counterAxisSpacing = ${wrapGap};` : ''}`}
        ${generateMinMaxCode('frame', props)}
        frame.clipsContent = ${clip};
        ${opacity !== null ? `frame.opacity = ${opacity};` : ''}
        ${visible === false ? `frame.visible = false;` : ''}
        ${locked === true ? `frame.locked = true;` : ''}

        ${childCode}

        ${opts.parent ? `
        // --parent: re-home the finished frame. Done AFTER the children exist
        // so an auto-layout parent measures real content, not the seed size.
        const __p = await figma.getNodeByIdAsync(${JSON.stringify(String(opts.parent))});
        if (!__p) throw new Error('Parent not found: ' + ${JSON.stringify(String(opts.parent))});
        if (!('appendChild' in __p)) throw new Error('Parent cannot contain children: ' + __p.type);
        __p.appendChild(frame);
        ${rootFill.applyAfterAppend ? `
        // w/h="fill" can only be set once the frame HAS a parent, and only if
        // that parent uses auto-layout — hence here and not up with the other
        // sizing props.
        if (__p.layoutMode && __p.layoutMode !== 'NONE') {
          ${fillWidth ? `frame.layoutSizingHorizontal = 'FILL';` : ''}
          ${fillHeight ? `frame.layoutSizingVertical = 'FILL';` : ''}
        } else {
          globalThis.__layoutWarnings.push(${JSON.stringify(`"${name}" fills ${[fillWidth && 'width', fillHeight && 'height'].filter(Boolean).join(' and ')}, but the --parent frame has no auto-layout`)});
        }` : ''}` : ''}
        ${rootFill.warnings.map(w => `globalThis.__layoutWarnings.push(${JSON.stringify(w)});`).join('\n        ')}

        // Surface unresolved var: references like the batch path does, so a
        // themed render that fell back to grey is visible to the caller.
        const __unresolved = globalThis.__unresolvedVars
          ? [...globalThis.__unresolvedVars].sort() : [];
        if (globalThis.__unresolvedVars) globalThis.__unresolvedVars = new Set();
        if (globalThis.__figHugFlush) globalThis.__figHugFlush();
        const __layoutWarnings = globalThis.__layoutWarnings || [];
        globalThis.__layoutWarnings = [];
        const __textStyles = {
          applied: globalThis.__textStyleApplied || [],
          warnings: globalThis.__textStyleWarnings || [],
        };
        globalThis.__textStyleApplied = [];
        globalThis.__textStyleWarnings = [];
        return (__unresolved.length > 0 || __layoutWarnings.length > 0 ||
                __textStyles.applied.length > 0 || __textStyles.warnings.length > 0)
          ? { id: frame.id, name: frame.name, unresolved: __unresolved, layoutWarnings: __layoutWarnings, textStyles: __textStyles }
          : { id: frame.id, name: frame.name };
        } catch(e) {
          // Guarded: createFrame() itself can throw, and a remove() that fails
          // must not replace the real error.
          if (frame) { try { frame.remove(); } catch (e2) {} }
          throw new Error('[Node: ' + __currentNode + '] ' + e.message);
        }
      })()
    `;
  }

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
    return str.replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi, (m, body) => {
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

  hexToRgb(hex) {
    if (!hex || !hex.startsWith('#')) return null;
    // Valid: #rgb, #rrggbb, #rrggbbaa (alpha handled by callers)
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
    let r, g, b;
    if (hex.length === 4) {
      r = parseInt(hex[1] + hex[1], 16) / 255;
      g = parseInt(hex[2] + hex[2], 16) / 255;
      b = parseInt(hex[3] + hex[3], 16) / 255;
    } else {
      r = parseInt(hex.slice(1, 3), 16) / 255;
      g = parseInt(hex.slice(3, 5), 16) / 255;
      b = parseInt(hex.slice(5, 7), 16) / 255;
    }
    return { r, g, b };
  }

  hexToRgbCode(hex) {
    // Support both #fff and #ffffff formats
    let r, g, b;
    if (hex.length === 4) {
      // #rgb -> #rrggbb
      r = parseInt(hex[1] + hex[1], 16) / 255;
      g = parseInt(hex[2] + hex[2], 16) / 255;
      b = parseInt(hex[3] + hex[3], 16) / 255;
    } else {
      // #rrggbb
      r = parseInt(hex.slice(1, 3), 16) / 255;
      g = parseInt(hex.slice(3, 5), 16) / 255;
      b = parseInt(hex.slice(5, 7), 16) / 255;
    }
    return `{r:${r},g:${g},b:${b}}`;
  }

  /**
   * Check if a value is a variable reference (var:name)
   */
  isVarRef(value) {
    return typeof value === 'string' && value.startsWith('var:');
  }

  /**
   * Extract variable name from var:name syntax
   */
  getVarName(value) {
    return value.slice(4); // Remove 'var:' prefix
  }

  /**
   * Generate fill code - either hex color or bound variable
   * Returns { code: string, usesVars: boolean }
   */
  generateFillCode(value, elementVar, property = 'fills') {
    // No fill at all → transparent. Lets callers default `bg` to null when
    // the user didn't ask for one, instead of forcing white.
    if (value === null || value === undefined) {
      return { code: `${elementVar}.${property} = [];`, usesVars: false };
    }
    if (this.isVarRef(value)) {
      const varName = this.getVarName(value);
      return {
        // Use lookupVar so the per-attr `var:collection:name` syntax resolves
        // even with a global --collection scope active. Falls back to vars[name].
        // Pass the requested key so unresolved names get reported instead of
        // silently rendering grey.
        code: `${elementVar}.${property} = [boundFill(lookupVar(${JSON.stringify(varName)}), ${JSON.stringify(varName)})];`,
        usesVars: true
      };
    }
    // Gradient: bg="linear-gradient(180deg, #FF0000, #00FF00)"
    if (typeof value === 'string' && /^(linear|radial|angular|diamond)-gradient\s*\(/i.test(value.trim())) {
      const paint = this.parseGradient(value);
      if (paint) {
        return { code: `${elementVar}.${property} = [${paint}];`, usesVars: false };
      }
    }
    return {
      code: `${elementVar}.${property} = [{type:'SOLID',color:${this.hexToRgbCode(value)}}];`,
      usesVars: false
    };
  }

  /**
   * Generate code that creates an image fill from a URL.
   * Uses figma.createImageAsync for remote URLs.
   * Returns code that prepends an image paint to fills.
   * scaleMode: FILL (default), FIT, CROP, TILE
   */
  generateImageFillCode(url, elementVar, scaleMode = 'FILL') {
    if (!url || typeof url !== 'string') return '';
    const mode = String(scaleMode).toUpperCase();
    const validModes = ['FILL', 'FIT', 'CROP', 'TILE'];
    const finalMode = validModes.includes(mode) ? mode : 'FILL';
    const safeName = elementVar.replace(/[^a-zA-Z0-9]/g, '');
    // Image REPLACES fills (not appends) — user expects bg-style behavior
    return `
      const __img${safeName} = await figma.createImageAsync(${JSON.stringify(url)});
      ${elementVar}.fills = [{ type: 'IMAGE', imageHash: __img${safeName}.hash, scaleMode: '${finalMode}' }];`;
  }

  /**
   * Parse a CSS-like gradient string into a Figma GradientPaint code expression.
   * Supports:
   *   linear-gradient(180deg, #FF0000, #00FF00)
   *   linear-gradient(180deg, #FF0000 0%, #00FF00 100%)
   *   radial-gradient(#FF0000, #00FF00)
   *   angular-gradient(#FF0000, #00FF00, #0000FF)
   *   diamond-gradient(#FF0000, #00FF00)
   */
  parseGradient(str) {
    const m = str.trim().match(/^(linear|radial|angular|diamond)-gradient\s*\(([\s\S]*)\)\s*$/i);
    if (!m) return null;
    const kind = m[1].toLowerCase();
    const typeMap = {
      linear: 'GRADIENT_LINEAR',
      radial: 'GRADIENT_RADIAL',
      angular: 'GRADIENT_ANGULAR',
      diamond: 'GRADIENT_DIAMOND',
    };
    const type = typeMap[kind];
    // Split top-level by commas (but not inside rgba(...))
    const parts = [];
    let depth = 0, buf = '';
    for (const ch of m[2]) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(buf.trim()); buf = ''; }
      else buf += ch;
    }
    if (buf.trim()) parts.push(buf.trim());
    if (parts.length < 2) return null;

    let angleDeg = 180; // CSS default: top to bottom
    let stopParts = parts;
    const angleMatch = parts[0].match(/^(-?\d+(?:\.\d+)?)deg$/i);
    if (angleMatch) {
      angleDeg = parseFloat(angleMatch[1]);
      stopParts = parts.slice(1);
    }
    if (stopParts.length < 2) return null;

    // Parse each stop: "#FF0000" or "#FF0000 50%" or "rgba(...) 50%"
    const stops = [];
    stopParts.forEach((sp, i) => {
      const posMatch = sp.match(/(-?\d+(?:\.\d+)?)%\s*$/);
      let pos = posMatch ? parseFloat(posMatch[1]) / 100 : i / (stopParts.length - 1);
      const colorStr = posMatch ? sp.slice(0, posMatch.index).trim() : sp.trim();
      let color;
      const rgbaMatch = colorStr.match(/^rgba?\(([^)]+)\)$/);
      if (rgbaMatch) {
        const ps = rgbaMatch[1].split(',').map(p => p.trim());
        color = {
          r: parseInt(ps[0]) / 255,
          g: parseInt(ps[1]) / 255,
          b: parseInt(ps[2]) / 255,
          a: ps.length > 3 ? parseFloat(ps[3]) : 1,
        };
      } else {
        const c = this.hexToRgb(colorStr);
        if (!c) return;
        let a = 1;
        if (colorStr.length === 9 && colorStr.startsWith('#')) {
          a = parseInt(colorStr.slice(7, 9), 16) / 255;
        }
        color = { ...c, a };
      }
      stops.push({ position: pos, color });
    });
    if (stops.length < 2) return null;

    // Compute gradientTransform from angle.
    // CSS 0deg = bottom-to-top (going up), 180deg = top-to-bottom.
    // Figma's gradientTransform's gradient line goes (0,0)->(1,0) in transformed coords.
    // For 180deg (top->bottom): want line direction = (0,1). Use rotation 90deg.
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // Center the gradient at (0.5, 0.5) before rotating
    const tx = 0.5 - 0.5 * cos + 0.5 * sin;
    const ty = 0.5 - 0.5 * sin - 0.5 * cos;
    const transform = `[[${cos.toFixed(4)},${(-sin).toFixed(4)},${tx.toFixed(4)}],[${sin.toFixed(4)},${cos.toFixed(4)},${ty.toFixed(4)}]]`;

    const stopsCode = stops.map(s =>
      `{position:${s.position},color:{r:${s.color.r.toFixed(4)},g:${s.color.g.toFixed(4)},b:${s.color.b.toFixed(4)},a:${s.color.a}}}`
    ).join(',');
    return `{type:'${type}',gradientStops:[${stopsCode}],gradientTransform:${transform}}`;
  }

  /**
   * Parse a CSS-like shadow string into a Figma effect descriptor.
   * Accepts: "0 4px 12px rgba(0,0,0,0.1)" / "0 2px 4px #00000040" / "0 4 12 #00000019"
   * Returns: { x, y, blur, color: {r,g,b,a} } or null
   */
  parseShadowString(s) {
    if (typeof s !== 'string') return null;
    let str = s.trim();
    // Tailwind-style keyword shortcuts. Designers expect shadow="lg" to work.
    const tailwind = {
      // Tailwind sizes
      sm:   '0 1px 2px rgba(0,0,0,0.05)',
      md:   '0 4px 6px rgba(0,0,0,0.1)',
      lg:   '0 10px 15px rgba(0,0,0,0.1)',
      xl:   '0 20px 25px rgba(0,0,0,0.1)',
      '2xl':'0 25px 50px rgba(0,0,0,0.25)',
      // Descriptive aliases (designers say "soft" not "md")
      soft: '0 4px 12px rgba(0,0,0,0.08)',
      subtle: '0 2px 4px rgba(0,0,0,0.06)',
      strong: '0 16px 32px rgba(0,0,0,0.2)',
      hard: '0 8px 0 rgba(0,0,0,1)',  // brutalist offset
      glow: '0 0 24px rgba(59,130,246,0.5)',  // colored glow
      none: null,
    };
    const lookup = tailwind[str.toLowerCase()];
    if (lookup === null) return null;
    if (lookup !== undefined) str = lookup;
    // Extract color (last hex or rgba(...))
    let color = null;
    const rgbaMatch = str.match(/rgba?\(([^)]+)\)\s*$/);
    if (rgbaMatch) {
      const parts = rgbaMatch[1].split(',').map(p => p.trim());
      color = {
        r: parseInt(parts[0]) / 255,
        g: parseInt(parts[1]) / 255,
        b: parseInt(parts[2]) / 255,
        a: parts.length > 3 ? parseFloat(parts[3]) : 1,
      };
      str = str.slice(0, rgbaMatch.index).trim();
    } else {
      const hexMatch = str.match(/#[0-9a-fA-F]{3,8}\s*$/);
      if (hexMatch) {
        const hex = hexMatch[0].trim();
        const c = this.hexToRgb(hex);
        if (c) {
          let a = 1;
          if (hex.length === 9) a = parseInt(hex.slice(7, 9), 16) / 255;
          color = { ...c, a };
        }
        str = str.slice(0, hexMatch.index).trim();
      }
    }
    if (!color) color = { r: 0, g: 0, b: 0, a: 0.1 };
    const nums = str.split(/\s+/).filter(Boolean).map(n => parseFloat(n));
    if (nums.length < 2) return null;
    return { x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, color };
  }

  /**
   * Generate code that sets `effects` on an element from JSX props.
   * Supported props:
   *   shadow="0 4px 12px rgba(0,0,0,0.1)"   — DROP_SHADOW
   *   innerShadow="0 2px 4px #00000040"     — INNER_SHADOW
   *   blur={4}                               — LAYER_BLUR
   *   bgBlur={8}                             — BACKGROUND_BLUR
   *   noise="mono|duo|multi"                 — NOISE grain (noiseDensity/noiseSize/noiseColor/noiseColor2/noiseOpacity)
   *   texture={true}                         — TEXTURE grain (textureSize/textureRadius/textureClip)
   *   progressiveBlur={40}                   — PROGRESSIVE blur (progressiveBlurDir=down|up|left|right)
   *   glass={true}                           — liquid GLASS (glassRefraction/glassDepth/glassRadius/glassDispersion/glassLight/glassLightAngle)
   * Multiple effects accumulate.
   */
  /**
   * Generic node-level props shared by ALL child node types (Ellipse, Rect,
   * Image — Frames handle these inline). Emits opacity, visible, rotation,
   * effects (blur/shadow/noise/…), and positioning. MUST be appended AFTER
   * appendChild (positioning needs a parent).
   *
   * Positioning: in a flex="none" (z-stack) parent, children are positioned by
   * plain x/y — setting layoutPositioning='ABSOLUTE' there THROWS (only valid in
   * auto-layout), so we set x/y directly. In an auto-layout parent, position=
   * "absolute" maps to layoutPositioning='ABSOLUTE' + x/y.
   */
  /**
   * FILL sizing for a leaf node (Rectangle / Ellipse / Image). Mirrors what a
   * Frame child does: emitted AFTER appendChild, because layoutSizing* only
   * exists once the node sits in an auto-layout parent. Before this, `w="fill"`
   * reached `resize()` as the string "fill" and the render died.
   * @param {{fillH:boolean, fillV:boolean}} sizing from resolveLeafSizing()
   */
  genLeafFillCode(sizing, varName) {
    if (!sizing || (!sizing.fillH && !sizing.fillV)) return '';
    const parts = [];
    if (sizing.fillH) parts.push(`${varName}.layoutSizingHorizontal = 'FILL';`, `globalThis.__figHugWarn(${varName}, 'H');`);
    if (sizing.fillV) parts.push(`${varName}.layoutSizingVertical = 'FILL';`, `globalThis.__figHugWarn(${varName}, 'V');`);
    return parts.join('\n        ');
  }

  genCommonNodeProps(item, varName, parentIsNone) {
    const parts = [];
    if (item.opacity !== undefined && item.opacity !== null) parts.push(`${varName}.opacity = ${Number(item.opacity)};`);
    if (item.visible === false || item.visible === 'false') parts.push(`${varName}.visible = false;`);
    if (item.rotate !== undefined) parts.push(`${varName}.rotation = ${Number(item.rotate)};`);
    const eff = this.generateEffectsCode(item, varName);
    if (eff && eff.trim()) parts.push(eff);
    const hasX = item.x !== undefined, hasY = item.y !== undefined;
    if (parentIsNone) {
      if (hasX) parts.push(`${varName}.x = ${Number(item.x)};`);
      if (hasY) parts.push(`${varName}.y = ${Number(item.y)};`);
    } else if (item.position === 'absolute' && (hasX || hasY)) {
      parts.push(`try { ${varName}.layoutPositioning = 'ABSOLUTE'; } catch (e) {}`);
      if (hasX) parts.push(`${varName}.x = ${Number(item.x)};`);
      if (hasY) parts.push(`${varName}.y = ${Number(item.y)};`);
    }
    return parts.join('\n        ');
  }

  generateEffectsCode(props, elementVar) {
    const effects = [];
    if (props.shadow) {
      const arr = Array.isArray(props.shadow) ? props.shadow : [props.shadow];
      for (const s of arr) {
        const e = this.parseShadowString(s);
        if (e) effects.push({ type: 'DROP_SHADOW', x: e.x, y: e.y, blur: e.blur, color: e.color });
      }
    }
    if (props.innerShadow) {
      const arr = Array.isArray(props.innerShadow) ? props.innerShadow : [props.innerShadow];
      for (const s of arr) {
        const e = this.parseShadowString(s);
        if (e) effects.push({ type: 'INNER_SHADOW', x: e.x, y: e.y, blur: e.blur, color: e.color });
      }
    }
    if (props.blur !== undefined && props.blur !== null) {
      const r = Number(props.blur);
      if (Number.isFinite(r) && r > 0) effects.push({ type: 'LAYER_BLUR', radius: r });
    }
    if (props.bgBlur !== undefined && props.bgBlur !== null) {
      const r = Number(props.bgBlur);
      if (Number.isFinite(r) && r > 0) effects.push({ type: 'BACKGROUND_BLUR', radius: r });
    }
    // Grain/noise overlay (NOISE effect). noise="mono|duo|multi" (mono default).
    //   noiseDensity={0..1} noiseSize={n} noiseColor="#hex" noiseColor2="#hex"(duo) noiseOpacity={0..1}(multi)
    if (props.noise !== undefined && props.noise !== null && props.noise !== 'false' && props.noise !== false) {
      const nv = String(props.noise).toLowerCase();
      let noiseType = 'MONOTONE';
      if (nv.startsWith('duo')) noiseType = 'DUOTONE';
      else if (nv.startsWith('multi')) noiseType = 'MULTITONE';
      const c = this.hexToRgb(props.noiseColor || '#000000') || { r: 0, g: 0, b: 0 };
      const eff = {
        type: 'NOISE', noiseType,
        density: props.noiseDensity !== undefined ? Number(props.noiseDensity) : 0.4,
        noiseSize: props.noiseSize !== undefined ? Number(props.noiseSize) : 1.5,
        color: { r: c.r, g: c.g, b: c.b, a: 1 }, visible: true,
      };
      if (noiseType === 'DUOTONE') {
        const c2 = this.hexToRgb(props.noiseColor2 || '#ffffff') || { r: 1, g: 1, b: 1 };
        eff.secondaryColor = { r: c2.r, g: c2.g, b: c2.b, a: 1 };
      } else if (noiseType === 'MULTITONE') {
        eff.opacity = props.noiseOpacity !== undefined ? Number(props.noiseOpacity) : 0.5;
      }
      effects.push({ _raw: eff });
    }
    // Paper/grain TEXTURE effect. texture={true} textureSize={n} textureRadius={n} textureClip={bool}
    if (props.texture !== undefined && props.texture !== null && props.texture !== 'false' && props.texture !== false) {
      effects.push({ _raw: {
        type: 'TEXTURE',
        noiseSize: props.textureSize !== undefined ? Number(props.textureSize) : 12,
        radius: props.textureRadius !== undefined ? Number(props.textureRadius) : 30,
        clipToShape: !(props.textureClip === 'false' || props.textureClip === false),
        visible: true,
      } });
    }
    // Progressive (gradient) blur. progressiveBlur={endRadius} progressiveBlurDir="down|up|left|right"
    if (props.progressiveBlur !== undefined && props.progressiveBlur !== null) {
      const r = Number(props.progressiveBlur);
      if (Number.isFinite(r) && r > 0) {
        const dir = String(props.progressiveBlurDir || 'down').toLowerCase();
        const O = {
          down:  { s: { x: 0.5, y: 0 }, e: { x: 0.5, y: 1 } },
          up:    { s: { x: 0.5, y: 1 }, e: { x: 0.5, y: 0 } },
          right: { s: { x: 0, y: 0.5 }, e: { x: 1, y: 0.5 } },
          left:  { s: { x: 1, y: 0.5 }, e: { x: 0, y: 0.5 } },
        };
        const o = O[dir] || O.down;
        effects.push({ _raw: {
          type: 'LAYER_BLUR', blurType: 'PROGRESSIVE', radius: r,
          startRadius: props.progressiveBlurStart !== undefined ? Number(props.progressiveBlurStart) : 0,
          startOffset: o.s, endOffset: o.e, visible: true,
        } });
      }
    }
    // Liquid GLASS effect. glass={true} glassRefraction/glassDepth/glassRadius/glassDispersion/glassLight/glassLightAngle
    if (props.glass !== undefined && props.glass !== null && props.glass !== 'false' && props.glass !== false) {
      // Defaults tuned for Apple-style "Liquid Glass": clear (low radius) with
      // strong edge lensing (high depth) + chromatic dispersion. For a frosted
      // look instead, pass a high glassRadius (e.g. 30) and lower glassDepth.
      effects.push({ _raw: {
        type: 'GLASS', visible: true,
        refraction: props.glassRefraction !== undefined ? Number(props.glassRefraction) : 0.95,
        depth: props.glassDepth !== undefined ? Number(props.glassDepth) : 50,
        radius: props.glassRadius !== undefined ? Number(props.glassRadius) : 6,
        dispersion: props.glassDispersion !== undefined ? Number(props.glassDispersion) : 0.4,
        lightIntensity: props.glassLight !== undefined ? Number(props.glassLight) : 0.7,
        lightAngle: props.glassLightAngle !== undefined ? Number(props.glassLightAngle) : 130,
      } });
    }
    if (effects.length === 0) return '';
    const figmaEffects = effects.map(e => {
      if (e._raw) return JSON.stringify(e._raw);
      if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
        return `{type:'${e.type}',color:{r:${e.color.r},g:${e.color.g},b:${e.color.b},a:${e.color.a}},offset:{x:${e.x},y:${e.y}},radius:${e.blur},spread:0,visible:true,blendMode:'NORMAL'}`;
      }
      return `{type:'${e.type}',radius:${e.radius},visible:true}`;
    });
    return `${elementVar}.effects = [${figmaEffects.join(',')}];`;
  }

  /**
   * Generate stroke code - either hex color or bound variable
   */
  generateStrokeCode(value, elementVar, strokeWidth = 1, strokeAlign = null) {
    const alignCode = strokeAlign ? ` ${elementVar}.strokeAlign = ${JSON.stringify(strokeAlign.toUpperCase())};` : '';
    if (this.isVarRef(value)) {
      const varName = this.getVarName(value);
      return {
        code: `${elementVar}.strokes = [boundFill(lookupVar(${JSON.stringify(varName)}), ${JSON.stringify(varName)})]; ${elementVar}.strokeWeight = ${strokeWidth};${alignCode}`,
        usesVars: true
      };
    } else {
      return {
        code: `${elementVar}.strokes = [{type:'SOLID',color:${this.hexToRgbCode(value)}}]; ${elementVar}.strokeWeight = ${strokeWidth};${alignCode}`,
        usesVars: false
      };
    }
  }

  // ============ Node Operations ============

  /**
   * Get a node by ID
   */
  async getNode(nodeId) {
    return await this.eval(`
      (async function() {
        const n = await figma.getNodeByIdAsync(${JSON.stringify(nodeId)});
        if (!n) return null;
        return {
          id: n.id,
          type: n.type,
          name: n.name || '',
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
          visible: n.visible,
          opacity: n.opacity
        };
      })()
    `);
  }

  /**
   * Delete a node by ID
   */
  async deleteNode(nodeId) {
    return await this.eval(`
      (async function() {
        const n = await figma.getNodeByIdAsync(${JSON.stringify(nodeId)});
        if (!n) return { success: false, error: 'Node not found' };
        n.remove();
        return { success: true };
      })()
    `);
  }

  /**
   * Move a node to new position
   */
  async moveNode(nodeId, x, y) {
    return await this.eval(`
      (async function() {
        const n = await figma.getNodeByIdAsync(${JSON.stringify(nodeId)});
        if (!n) return { success: false, error: 'Node not found' };
        n.x = ${x};
        n.y = ${y};
        return { success: true, x: n.x, y: n.y };
      })()
    `);
  }

  /**
   * Get current selection
   */
  async getSelection() {
    return await this.eval(`
      figma.currentPage.selection.map(n => ({
        id: n.id,
        type: n.type,
        name: n.name || ''
      }))
    `);
  }

  /**
   * Set selection by node IDs
   */
  async setSelection(nodeIds) {
    const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
    return await this.eval(`
      (async function() {
        const nodes = (await Promise.all(${JSON.stringify(ids)}.map(id => figma.getNodeByIdAsync(id)))).filter(n => n);
        figma.currentPage.selection = nodes;
        return nodes.map(n => n.id);
      })()
    `);
  }

  /**
   * Create a frame
   */
  async createFrame(options = {}) {
    const { name = 'Frame', width = 100, height = 100, x, y, fill = '#ffffff', radius = 0 } = options;
    return await this.eval(`
      (function() {
        const frame = figma.createFrame();
        frame.name = ${JSON.stringify(name)};
        frame.resize(${width}, ${height});
        ${x !== undefined ? `frame.x = ${x};` : ''}
        ${y !== undefined ? `frame.y = ${y};` : ''}
        frame.cornerRadius = ${radius};
        frame.fills = [{type:'SOLID',color:${this.hexToRgbCode(fill)}}];
        return { id: frame.id, name: frame.name, x: frame.x, y: frame.y };
      })()
    `);
  }

  /**
   * Create a rectangle
   */
  async createRectangle(options = {}) {
    const { name = 'Rectangle', width = 100, height = 100, x, y, fill = '#d9d9d9', radius = 0 } = options;
    return await this.eval(`
      (function() {
        const rect = figma.createRectangle();
        rect.name = ${JSON.stringify(name)};
        rect.resize(${width}, ${height});
        ${x !== undefined ? `rect.x = ${x};` : ''}
        ${y !== undefined ? `rect.y = ${y};` : ''}
        rect.cornerRadius = ${radius};
        rect.fills = [{type:'SOLID',color:${this.hexToRgbCode(fill)}}];
        return { id: rect.id, name: rect.name };
      })()
    `);
  }

  /**
   * Create an ellipse/circle
   */
  async createEllipse(options = {}) {
    const { name = 'Ellipse', width = 100, height = 100, x, y, fill = '#d9d9d9' } = options;
    return await this.eval(`
      (function() {
        const ellipse = figma.createEllipse();
        ellipse.name = ${JSON.stringify(name)};
        ellipse.resize(${width}, ${height || width});
        ${x !== undefined ? `ellipse.x = ${x};` : ''}
        ${y !== undefined ? `ellipse.y = ${y};` : ''}
        ellipse.fills = [{type:'SOLID',color:${this.hexToRgbCode(fill)}}];
        return { id: ellipse.id, name: ellipse.name };
      })()
    `);
  }

  /**
   * Create a text node
   */
  async createText(options = {}) {
    const { content = 'Text', x, y, size = 14, color = '#000000', weight = 'Regular' } = options;
    const style = weight === 'bold' ? 'Bold' : weight === 'medium' ? 'Medium' : 'Regular';
    return await this.eval(`
      (async function() {
        await figma.loadFontAsync({family:'Inter',style:'${style}'});
        const text = figma.createText();
        text.fontName = {family:'Inter',style:'${style}'};
        text.fontSize = ${size};
        text.characters = ${JSON.stringify(content)};
        text.fills = [{type:'SOLID',color:${this.hexToRgbCode(color)}}];
        ${x !== undefined ? `text.x = ${x};` : ''}
        ${y !== undefined ? `text.y = ${y};` : ''}
        return { id: text.id, characters: text.characters };
      })()
    `);
  }

  /**
   * Create a line
   */
  async createLine(options = {}) {
    const { length = 100, x, y, color = '#000000', strokeWeight = 1 } = options;
    return await this.eval(`
      (function() {
        const line = figma.createLine();
        line.resize(${length}, 0);
        ${x !== undefined ? `line.x = ${x};` : ''}
        ${y !== undefined ? `line.y = ${y};` : ''}
        line.strokes = [{type:'SOLID',color:${this.hexToRgbCode(color)}}];
        line.strokeWeight = ${strokeWeight};
        return { id: line.id };
      })()
    `);
  }

  /**
   * Create a variable
   */
  async createVariable(options = {}) {
    const { name, collectionId, type = 'COLOR', value } = options;
    return await this.eval(`
      (function() {
        const col = figma.variables.getVariableCollectionById(${JSON.stringify(collectionId)});
        if (!col) return { error: 'Collection not found' };
        const variable = figma.variables.createVariable(${JSON.stringify(name)}, col, ${JSON.stringify(type)});
        ${value ? `variable.setValueForMode(col.defaultModeId, ${type === 'COLOR' ? this.hexToRgbCode(value) : JSON.stringify(value)});` : ''}
        return { id: variable.id, name: variable.name };
      })()
    `);
  }

  /**
   * Create a component from a frame
   */
  async createComponent(nodeId) {
    return await this.eval(`
      (async function() {
        const node = await figma.getNodeByIdAsync(${JSON.stringify(nodeId)});
        if (!node) return { error: 'Node not found' };
        const component = figma.createComponentFromNode(node);
        return { id: component.id, name: component.name };
      })()
    `);
  }

  /**
   * Create an instance of a component
   */
  async createInstance(componentId, x, y) {
    return await this.eval(`
      (async function() {
        const comp = await figma.getNodeByIdAsync(${JSON.stringify(componentId)});
        if (!comp || comp.type !== 'COMPONENT') return { error: 'Component not found' };
        const instance = comp.createInstance();
        ${x !== undefined ? `instance.x = ${x};` : ''}
        ${y !== undefined ? `instance.y = ${y};` : ''}
        return { id: instance.id, name: instance.name, x: instance.x, y: instance.y };
      })()
    `);
  }

  /**
   * Export a node as SVG
   */
  async exportSVG(nodeId) {
    return await this.eval(`
      (async function() {
        const node = await figma.getNodeByIdAsync(${JSON.stringify(nodeId)});
        if (!node) return { error: 'Node not found' };
        const bytes = await node.exportAsync({ format: 'SVG' });
        return { svg: String.fromCharCode.apply(null, bytes) };
      })()
    `);
  }

  // ============ Layout ============

  /**
   * Swap a component instance to another library component
   */
  async swapComponent(instanceId, newComponentKey) {
    return await this.eval(`
      (async function() {
        const instance = await figma.getNodeByIdAsync(${JSON.stringify(instanceId)});
        if (!instance || instance.type !== 'INSTANCE') return { error: 'Instance not found' };

        const newComponent = await figma.importComponentByKeyAsync(${JSON.stringify(newComponentKey)});
        instance.swapComponent(newComponent);

        return { success: true, newComponentName: newComponent.name };
      })()
    `);
  }

  // ============ Designer Utilities ============

  /**
   * Batch rename layers with pattern
   * Patterns: {n} = number, {name} = original name, {type} = node type
   */
  async batchRename(nodeIds, pattern, options = {}) {
    const { startNumber = 1, case: textCase = null } = options;
    return await this.eval(`
      (async function() {
        const ids = ${JSON.stringify(nodeIds)};
        const pattern = ${JSON.stringify(pattern)};
        let num = ${startNumber};
        const results = [];

        for (const id of ids) {
          const node = await figma.getNodeByIdAsync(id);
          if (!node) continue;

          let newName = pattern
            .replace(/{n}/g, num)
            .replace(/{name}/g, node.name)
            .replace(/{type}/g, node.type.toLowerCase());

          ${textCase === 'camel' ? "newName = newName.replace(/[-_\\s]+(\\w)/g, (_, c) => c.toUpperCase()).replace(/^\\w/, c => c.toLowerCase());" : ''}
          ${textCase === 'pascal' ? "newName = newName.replace(/[-_\\s]+(\\w)/g, (_, c) => c.toUpperCase()).replace(/^\\w/, c => c.toUpperCase());" : ''}
          ${textCase === 'snake' ? "newName = newName.replace(/[\\s-]+/g, '_').toLowerCase();" : ''}
          ${textCase === 'kebab' ? "newName = newName.replace(/[\\s_]+/g, '-').toLowerCase();" : ''}

          node.name = newName;
          results.push({ id: node.id, name: newName });
          num++;
        }

        return results;
      })()
    `);
  }

  /**
   * Generate lorem ipsum text
   */
  async loremIpsum(options = {}) {
    const { type = 'paragraph', count = 1 } = options;
    const lorem = {
      words: ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo', 'consequat'],
      paragraph: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.'
    };

    if (type === 'words') {
      const words = [];
      for (let i = 0; i < count; i++) {
        words.push(lorem.words[Math.floor(Math.random() * lorem.words.length)]);
      }
      return words.join(' ');
    } else if (type === 'sentences') {
      const sentences = [];
      for (let i = 0; i < count; i++) {
        const wordCount = 8 + Math.floor(Math.random() * 8);
        const words = [];
        for (let j = 0; j < wordCount; j++) {
          words.push(lorem.words[Math.floor(Math.random() * lorem.words.length)]);
        }
        words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
        sentences.push(words.join(' ') + '.');
      }
      return sentences.join(' ');
    } else {
      return Array(count).fill(lorem.paragraph).join('\n\n');
    }
  }

  /**
   * Insert image from URL (Unsplash, etc.)
   */
  async insertImage(imageUrl, options = {}) {
    const { x = 0, y = 0, width = 400, height = 300, name = 'Image' } = options;

    // Fetch image and convert to base64
    const response = await fetch(imageUrl);
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    return await this.eval(`
      (async function() {
        const imageData = Uint8Array.from(atob(${JSON.stringify(base64)}), c => c.charCodeAt(0));
        const image = figma.createImage(imageData);

        const rect = figma.createRectangle();
        rect.name = ${JSON.stringify(name)};
        rect.x = ${x};
        rect.y = ${y};
        rect.resize(${width}, ${height});
        rect.fills = [{
          type: 'IMAGE',
          scaleMode: 'FILL',
          imageHash: image.hash
        }];

        return { id: rect.id, name: rect.name, imageHash: image.hash };
      })()
    `);
  }

  /**
   * Check contrast ratio between two colors (WCAG)
   */
  checkContrast(color1, color2) {
    const getLuminance = (hex) => {
      const rgb = [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255
      ].map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    };

    const l1 = getLuminance(color1);
    const l2 = getLuminance(color2);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

    return {
      ratio: Math.round(ratio * 100) / 100,
      AA: ratio >= 4.5,
      AALarge: ratio >= 3,
      AAA: ratio >= 7,
      AAALarge: ratio >= 4.5
    };
  }

  /**
   * Export a node to JSX code
   */
  async exportToJSX(nodeId, options = {}) {
    const { pretty = true } = options;
    return await this.eval(`
      (async function() {
        const node = await figma.getNodeByIdAsync(${JSON.stringify(nodeId)});
        if (!node) return { error: 'Node not found' };

        function rgbToHex(r, g, b) {
          return '#' + [r, g, b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
        }

        function nodeToJSX(n, indent = 0) {
          const pad = ${pretty} ? '  '.repeat(indent) : '';
          const nl = ${pretty} ? '\\n' : '';

          let tag = 'Frame';
          if (n.type === 'TEXT') tag = 'Text';
          else if (n.type === 'RECTANGLE') tag = 'Rectangle';
          else if (n.type === 'ELLIPSE') tag = 'Ellipse';
          else if (n.type === 'LINE') tag = 'Line';
          else if (n.type === 'VECTOR') tag = 'Vector';
          else if (n.type === 'COMPONENT') tag = 'Component';
          else if (n.type === 'INSTANCE') tag = 'Instance';

          const props = [];
          if (n.name) props.push('name="' + n.name + '"');
          if (n.width) props.push('w={' + Math.round(n.width) + '}');
          if (n.height) props.push('h={' + Math.round(n.height) + '}');

          if (n.fills && n.fills.length > 0 && n.fills[0].type === 'SOLID') {
            const c = n.fills[0].color;
            props.push('bg="' + rgbToHex(c.r, c.g, c.b) + '"');
          }

          if (n.cornerRadius && n.cornerRadius > 0) {
            props.push('rounded={' + n.cornerRadius + '}');
          }

          if (n.layoutMode === 'HORIZONTAL') props.push('flex="row"');
          if (n.layoutMode === 'VERTICAL') props.push('flex="col"');
          if (n.itemSpacing) props.push('gap={' + n.itemSpacing + '}');
          if (n.paddingTop) props.push('p={' + n.paddingTop + '}');

          if (n.type === 'TEXT') {
            const fontSize = n.fontSize || 14;
            props.push('size={' + fontSize + '}');
            if (n.fontName && n.fontName.style) {
              const weight = n.fontName.style.toLowerCase();
              if (weight.includes('bold')) props.push('weight="bold"');
              else if (weight.includes('medium')) props.push('weight="medium"');
            }
            if (n.fills && n.fills[0] && n.fills[0].type === 'SOLID') {
              const c = n.fills[0].color;
              props.push('color="' + rgbToHex(c.r, c.g, c.b) + '"');
            }
            return pad + '<Text ' + props.join(' ') + '>' + (n.characters || '') + '</Text>';
          }

          const hasChildren = n.children && n.children.length > 0;
          const propsStr = props.length > 0 ? ' ' + props.join(' ') : '';

          if (!hasChildren) {
            return pad + '<' + tag + propsStr + ' />';
          }

          const childrenJSX = n.children.map(c => nodeToJSX(c, indent + 1)).join(nl);
          return pad + '<' + tag + propsStr + '>' + nl + childrenJSX + nl + pad + '</' + tag + '>';
        }

        return { jsx: nodeToJSX(node) };
      })()
    `);
  }

  /**
   * Query nodes with XPath-like syntax
   * Examples:
   *   //FRAME - all frames
   *   //TEXT[@fontSize > 20] - text larger than 20px
   *   //FRAME[contains(@name, 'Card')] - frames with 'Card' in name
   *   //*[@cornerRadius > 0] - any node with radius
   */
  async query(xpath) {
    return await this.eval(`
      (function() {
        const xpath = ${JSON.stringify(xpath)};
        const results = [];

        // Parse simple XPath patterns
        const typeMatch = xpath.match(/\\/\\/([A-Z_*]+)/);
        const attrMatch = xpath.match(/@(\\w+)\\s*(=|>|<|>=|<=|!=)\\s*["']?([^"'\\]]+)["']?/);
        const containsMatch = xpath.match(/contains\\(@(\\w+),\\s*["']([^"']+)["']\\)/);
        const startsMatch = xpath.match(/starts-with\\(@(\\w+),\\s*["']([^"']+)["']\\)/);

        const targetType = typeMatch ? typeMatch[1] : '*';

        function matches(node) {
          // Type check
          if (targetType !== '*' && node.type !== targetType) return false;

          // Attribute comparison
          if (attrMatch) {
            const [, attr, op, val] = attrMatch;
            const nodeVal = node[attr];
            const numVal = parseFloat(val);

            if (op === '=' && nodeVal != val && nodeVal != numVal) return false;
            if (op === '!=' && (nodeVal == val || nodeVal == numVal)) return false;
            if (op === '>' && !(nodeVal > numVal)) return false;
            if (op === '<' && !(nodeVal < numVal)) return false;
            if (op === '>=' && !(nodeVal >= numVal)) return false;
            if (op === '<=' && !(nodeVal <= numVal)) return false;
          }

          // contains()
          if (containsMatch) {
            const [, attr, val] = containsMatch;
            if (!node[attr] || !String(node[attr]).includes(val)) return false;
          }

          // starts-with()
          if (startsMatch) {
            const [, attr, val] = startsMatch;
            if (!node[attr] || !String(node[attr]).startsWith(val)) return false;
          }

          return true;
        }

        function search(node) {
          if (matches(node)) {
            results.push({
              id: node.id,
              type: node.type,
              name: node.name || '',
              x: Math.round(node.x || 0),
              y: Math.round(node.y || 0),
              width: Math.round(node.width || 0),
              height: Math.round(node.height || 0)
            });
          }
          if (node.children) node.children.forEach(search);
        }

        search(figma.currentPage);
        return results.slice(0, 200);
      })()
    `);
  }

  // ============ Path/Vector Operations ============

  /**
   * Get vector path data from a node
   */
  async getPath(nodeId) {
    return await this.eval(`
      (async function() {
        const node = await figma.getNodeByIdAsync(${JSON.stringify(nodeId)});
        if (!node) return { error: 'Node not found' };
        if (!node.vectorPaths) return { error: 'Node has no vector paths' };

        return {
          id: node.id,
          name: node.name,
          paths: node.vectorPaths.map(p => ({
            data: p.data,
            windingRule: p.windingRule
          }))
        };
      })()
    `);
  }

  /**
   * Set vector path data on a node
   */
  async setPath(nodeId, pathData) {
    return await this.eval(`
      (async function() {
        const node = await figma.getNodeByIdAsync(${JSON.stringify(nodeId)});
        if (!node) return { error: 'Node not found' };
        if (node.type !== 'VECTOR') return { error: 'Node is not a vector' };

        node.vectorPaths = [{ data: ${JSON.stringify(pathData)}, windingRule: 'EVENODD' }];
        return { success: true };
      })()
    `);
  }

  /**
   * Add a new mode to a variable collection
   */
  async addMode(collectionId, modeName) {
    return await this.eval(`
      (function() {
        const col = figma.variables.getVariableCollectionById(${JSON.stringify(collectionId)});
        if (!col) return { error: 'Collection not found' };

        const modeId = col.addMode(${JSON.stringify(modeName)});
        return {
          success: true,
          modeId,
          modeName: ${JSON.stringify(modeName)},
          allModes: col.modes
        };
      })()
    `);
  }

  /**
   * Rename a mode in a variable collection
   */
  async renameMode(collectionId, modeId, newName) {
    return await this.eval(`
      (function() {
        const col = figma.variables.getVariableCollectionById(${JSON.stringify(collectionId)});
        if (!col) return { error: 'Collection not found' };

        col.renameMode(${JSON.stringify(modeId)}, ${JSON.stringify(newName)});
        return { success: true, modeId: ${JSON.stringify(modeId)}, newName: ${JSON.stringify(newName)} };
      })()
    `);
  }

  /**
   * Remove a mode from a variable collection
   */
  async removeMode(collectionId, modeId) {
    return await this.eval(`
      (function() {
        const col = figma.variables.getVariableCollectionById(${JSON.stringify(collectionId)});
        if (!col) return { error: 'Collection not found' };

        col.removeMode(${JSON.stringify(modeId)});
        return { success: true, modeId: ${JSON.stringify(modeId)} };
      })()
    `);
  }

  /**
   * Set description on a component (supports markdown)
   */
  async setComponentDescription(componentId, description) {
    return await this.eval(`
      (async function() {
        const node = await figma.getNodeByIdAsync(${JSON.stringify(componentId)});
        if (!node) return { error: 'Node not found' };
        if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
          return { error: 'Node is not a component' };
        }

        node.description = ${JSON.stringify(description)};
        return { success: true, id: node.id, description: node.description };
      })()
    `);
  }

  close() {
    this.rejectPending(new Error('CDP connection closed'));
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }
}

export default FigmaClient;
