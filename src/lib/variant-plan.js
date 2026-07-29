// Pure planning layer for `figma-cli variants from`.
//
// Turning N nodes into a Component Set is two decisions: what each component
// must be NAMED (Figma derives variant properties purely from the name) and
// what the set itself is called. Both are pure string work, so they live here
// instead of inside the Figma eval string — that way every rule below is unit
// testable and can never silently drift from what the eval does.
//
// Two naming modes:
//   single-axis  --property Size --values Small,Medium,Large  → "Size=Small"
//   multi-axis   --multi, names already carry the axes        → kept as-is
//
// Multi-axis exists because real design systems (Primer's Button: variant ×
// size × state × alignContent = 144 variants) cannot be expressed with one
// property. Before this, that case forced a hand-written `figma.combineAsVariants`
// eval — exactly the kind of ad-hoc scripting the CLI is supposed to remove.

/** `variant=primary, size=small` → [['variant','primary'], ['size','small']]. */
function parsePairs(name) {
  const parts = String(name).split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const pairs = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) return null;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key || !value) return null;
    pairs.push([key, value]);
  }
  return pairs;
}

/**
 * Multi-axis plan: every node keeps its own `prop=value, prop2=value2` name.
 * Figma reads those names to build the variant properties, so the names must
 * agree on the axis SET (same keys, same order-insensitive) or Figma invents
 * bogus "Property 1" axes instead of erroring.
 */
function planMulti(nodes, setName) {
  const bad = [];
  const parsed = [];
  for (const n of nodes) {
    const pairs = parsePairs(n.name);
    if (!pairs) { bad.push(n.name); continue; }
    parsed.push({ id: n.id, name: n.name, pairs });
  }
  if (bad.length) {
    return {
      error: `--multi needs every node named "prop=value, prop2=value2". Not parseable: ${bad.slice(0, 3).map(b => `"${b}"`).join(', ')}${bad.length > 3 ? ` (+${bad.length - 3} more)` : ''}`,
    };
  }

  const keySig = (pairs) => pairs.map(([k]) => k).slice().sort().join('|');
  const sig = keySig(parsed[0].pairs);
  const mismatch = parsed.find(p => keySig(p.pairs) !== sig);
  if (mismatch) {
    return {
      error: `All nodes must share the same variant properties. "${parsed[0].name}" has [${parsed[0].pairs.map(([k]) => k).join(', ')}] but "${mismatch.name}" has [${mismatch.pairs.map(([k]) => k).join(', ')}].`,
    };
  }

  const seen = new Map();
  for (const p of parsed) {
    const combo = p.pairs.slice().sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v}`).join(', ');
    if (seen.has(combo)) {
      return { error: `Duplicate variant combination "${combo}" (nodes ${seen.get(combo)} and ${p.id}). Each combination must be unique.` };
    }
    seen.set(combo, p.id);
  }

  // Axis order follows the first node; values keep first-seen order so the
  // printed summary reads like the design system's own ordering.
  const axes = {};
  for (const [k] of parsed[0].pairs) axes[k] = [];
  for (const p of parsed) {
    for (const [k, v] of p.pairs) {
      if (axes[k] && !axes[k].includes(v)) axes[k].push(v);
    }
  }

  return {
    assignments: parsed.map(p => ({ id: p.id, name: p.name })),
    axes,
    setName: setName || 'Component',
  };
}

/**
 * Single-axis plan: names are rewritten to pure "Property=Value".
 * The base name is carried by the Component Set, never by the variants —
 * "Button, Size=Small" would make Figma derive a second, unnamed property.
 */
function planSingle(nodes, property, values, setName) {
  if (nodes.length !== values.length) {
    return { error: `ID count (${nodes.length}) must equal --values count (${values.length}).` };
  }
  const dupe = values.find((v, i) => values.indexOf(v) !== i);
  if (dupe) return { error: `Duplicate value "${dupe}" in --values. Each variant value must be unique.` };

  return {
    assignments: nodes.map((n, i) => ({ id: n.id, name: `${property}=${values[i]}` })),
    axes: { [property]: values.slice() },
    setName: setName || deriveBaseName(nodes[0]?.name),
  };
}

/**
 * Strip variant noise off a node name to get a set name:
 * "Button, Size=Small" → "Button", "Button/primary" → "Button".
 */
export function deriveBaseName(name) {
  let n = String(name || 'Component');
  n = n.replace(/\s*,\s*[^,=]+=[^,]+(?:,\s*[^,=]+=[^,]+)*\s*$/, '');
  n = n.replace(/\s*\/.*$/, '');
  n = n.trim();
  return n || 'Component';
}

/**
 * Plan a Component Set build.
 *
 * @param {Array<{id:string,name:string}>} nodes  nodes in the order given
 * @param {{property?:string, values?:string[], multi?:boolean, setName?:string}} opts
 * @returns {{assignments?:Array<{id,name}>, axes?:Object, setName?:string, error?:string}}
 */
export function planVariants(nodes = [], opts = {}) {
  const { property, values, multi, setName } = opts;

  if (multi && (property || (values && values.length))) {
    return { error: '--multi derives the properties from the node names — do not combine it with --property/--values.' };
  }
  if (!multi && !property) {
    return { error: 'Need --property and --values (or --multi to read the axes from the node names).' };
  }
  if (nodes.length < 2) {
    return { error: `Need at least 2 nodes to create a Variant Set (got ${nodes.length}).` };
  }
  const ids = nodes.map(n => n.id);
  const dupeId = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dupeId) return { error: `Node ${dupeId} was passed twice.` };

  return multi
    ? planMulti(nodes, setName)
    : planSingle(nodes, property, values || [], setName);
}
