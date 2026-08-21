/**
 * Reading a file's variables and text styles back OUT of Figma.
 *
 * The CLI could create tokens (`tokens`, `import`) but never hand them over: `variables list`
 * prints prose, and there was no JSON anywhere. The code side needs the opposite direction, and
 * the alternatives do not cover it — Figma's REST API withholds local variables below the
 * Enterprise plan, and tools built on it return resolved hex values without names.
 *
 * Two details this exists to get right, both learned from a real handoff:
 *
 * - **An alias needs its target's name *and* its resolved value.** In a real system every
 *   semantic variable was an alias into the primitives and not one held a raw value. Emitting
 *   only the name forces the consumer to resolve the chain; emitting only the value throws the
 *   cascade away. Both are cheap here, where the id → name map already exists.
 * - **Figma reports a font weight as a style *string*** — `"Bold"`, `"SemiBold"` — so anything
 *   that wants a CSS weight has to map it. Doing that per consumer is how two of them disagree.
 */

/** Style name → CSS weight. The names Figma ships; anything unknown stays honest as null. */
const WEIGHTS = [
  [900, ['black', 'heavy', 'ultrablack', 'extrablack']],
  [800, ['extrabold', 'ultrabold']],
  [700, ['bold']],
  [600, ['semibold', 'demibold']],
  [500, ['medium']],
  [400, ['regular', 'normal', 'book', 'roman']],
  [300, ['light']],
  [200, ['extralight', 'ultralight']],
  [100, ['thin', 'hairline']]
];

/**
 * The CSS weight behind a Figma style name.
 *
 * Order matters: `extrabold` contains `bold`, `semibold` contains `bold`, and matching the
 * shorter one first would report 700 for all three. Heaviest-first with a normalised needle
 * avoids that. Italic and width suffixes are dropped — they are not weights.
 */
export function weightFromStyle(style) {
  if (typeof style !== 'string' || !style.trim()) return null;
  const needle = style
    .toLowerCase()
    .replace(/italic|oblique|condensed|expanded|narrow|wide/g, '')
    .replace(/[^a-z]/g, '');
  if (!needle) return 400; // "Italic" alone is a regular weight.
  for (const [weight, names] of WEIGHTS) {
    if (names.some((name) => needle.includes(name))) return weight;
  }
  return null;
}

/** `{r,g,b,a}` in Figma's 0..1 floats → `#rrggbb`, plus alpha only when it carries information. */
export function rgbaToHex(color) {
  if (!color || typeof color !== 'object') return null;
  const part = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 255).toString(16).padStart(2, '0');
  const base = `#${part(color.r)}${part(color.g)}${part(color.b)}`;
  const a = color.a;
  return a == null || a >= 1 ? base : base + part(a);
}

/**
 * The eval that gathers everything in one round trip.
 *
 * Written as source rather than assembled from objects so the whole read happens inside Figma:
 * resolving an alias chain node-side would be one async call per hop.
 */
export function variablesExportCode() {
  return `(async () => {
  const hex = (c) => {
    const p = (v) => Math.round(Math.max(0, Math.min(1, v || 0)) * 255).toString(16).padStart(2, '0');
    const base = '#' + p(c.r) + p(c.g) + p(c.b);
    return (c.a == null || c.a >= 1) ? base : base + p(c.a);
  };

  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();
  const varById = new Map(variables.map(v => [v.id, v]));
  const colById = new Map(collections.map(c => [c.id, c]));

  const fullName = (v) => {
    const col = colById.get(v.variableCollectionId);
    return (col ? col.name + ':' : '') + v.name;
  };

  // Follow the alias chain to the value that actually paints, remembering the first hop's name.
  // The depth guard is for a file that aliases in a circle — rare, but it would hang the eval.
  const resolve = (value, modeId, depth) => {
    if (!value || typeof value !== 'object' || value.type !== 'VARIABLE_ALIAS') return { value };
    if (depth > 12) return { alias: '(cycle)', value: null };
    const target = varById.get(value.id);
    if (!target) return { alias: '(remote or missing)', value: null };
    const targetCol = colById.get(target.variableCollectionId);
    // A target in another collection has its own modes; its default mode is the honest pick.
    const targetMode = targetCol && targetCol.modes.some(m => m.modeId === modeId)
      ? modeId
      : (targetCol ? targetCol.defaultModeId : modeId);
    const next = resolve(target.valuesByMode[targetMode], targetMode, depth + 1);
    return { alias: fullName(target), value: next.value };
  };

  const out = { file: figma.root.name, collections: [], textStyles: [] };

  for (const col of collections) {
    const entry = {
      id: col.id,
      name: col.name,
      defaultModeId: col.defaultModeId,
      modes: col.modes.map(m => ({ modeId: m.modeId, name: m.name })),
      variables: []
    };
    for (const v of variables.filter(v => v.variableCollectionId === col.id)) {
      const values = {};
      for (const mode of col.modes) {
        const raw = v.valuesByMode[mode.modeId];
        const r = resolve(raw, mode.modeId, 0);
        const value = (v.resolvedType === 'COLOR' && r.value && typeof r.value === 'object')
          ? hex(r.value)
          : r.value;
        values[mode.name] = r.alias ? { value, alias: r.alias } : { value };
      }
      entry.variables.push({
        id: v.id,
        name: v.name,
        type: v.resolvedType,
        scopes: v.scopes,
        values
      });
    }
    out.collections.push(entry);
  }

  for (const s of await figma.getLocalTextStylesAsync()) {
    out.textStyles.push({
      id: s.id,
      name: s.name,
      fontFamily: s.fontName.family,
      fontStyle: s.fontName.style,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      textCase: s.textCase,
      textDecoration: s.textDecoration
    });
  }

  return JSON.stringify(out);
})()`;
}

/**
 * Everything the eval could not compute inside Figma: the CSS weight behind each style name,
 * and line height / letter spacing in a shape a consumer can use without knowing Figma's units.
 */
export function shapeExport(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data || typeof data !== 'object') return null;

  const length = (value) => {
    if (!value || typeof value !== 'object') return null;
    if (value.unit === 'AUTO') return { unit: 'AUTO' };
    if (value.unit === 'PERCENT') return { unit: 'PERCENT', value: value.value };
    return { unit: 'PIXELS', value: value.value };
  };

  return {
    file: data.file ?? '',
    collections: (data.collections ?? []).map((col) => ({
      ...col,
      variables: col.variables ?? []
    })),
    textStyles: (data.textStyles ?? []).map((style) => ({
      ...style,
      fontWeight: weightFromStyle(style.fontStyle),
      lineHeight: length(style.lineHeight),
      letterSpacing: length(style.letterSpacing)
    }))
  };
}

/** A short human summary, for the run that is not piped into a file. */
export function summarize(shaped) {
  if (!shaped) return 'nothing to export';
  const variables = shaped.collections.reduce((sum, col) => sum + col.variables.length, 0);
  const aliases = shaped.collections.reduce(
    (sum, col) =>
      sum +
      col.variables.filter((v) => Object.values(v.values ?? {}).some((entry) => entry && entry.alias))
        .length,
    0
  );
  const modes = shaped.collections.reduce((sum, col) => sum + col.modes.length, 0);
  return (
    `${String(shaped.collections.length)} collection(s), ${String(modes)} mode(s), ` +
    `${String(variables)} variable(s) (${String(aliases)} alias), ` +
    `${String(shaped.textStyles.length)} text style(s)`
  );
}
