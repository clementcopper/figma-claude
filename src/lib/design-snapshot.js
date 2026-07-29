// Canonical, machine-readable snapshot of a design system + a deterministic
// differ.
//
// WHY THIS EXISTS
// ---------------
// `extract` writes DESIGN.md — prose meant for humans and LLMs. Prose has to be
// *interpreted*, so the only way to answer "is this still correct?" today is a
// human looking at it. That makes every validation probabilistic.
//
// This module turns the same extraction into a CANONICAL form: volatile data
// (node ids, publish keys, timestamps) removed, unordered collections sorted,
// floats rounded. Two canonical snapshots of the same design system are then
// byte-identical, which buys two deterministic guarantees with no model in the
// loop:
//
//   1. Roundtrip proof — extract → import → extract must produce an identical
//      snapshot. If it doesn't, the representation is lossy and the diff says
//      exactly where. (This is what catches bugs like "tokens re-import white".)
//   2. Drift detection — a committed snapshot is a contract. Re-extract later
//      and any change shows up as a reviewable diff, like a code snapshot test.
//
// Everything here is PURE: no Figma, no I/O, no daemon. That's deliberate —
// the validation path must be testable and reproducible on its own.

import { resolveAliases } from '../design-extract.js';

// Bump when the canonical shape changes in a way that invalidates committed
// snapshots, so `check` can say "regenerate" instead of reporting bogus drift.
//   1 → 2: nodes carry `bv` (bound design tokens) and `rx` (prototype reactions)
export const SNAPSHOT_VERSION = 2;

// Node fields the walker emits that are VOLATILE — they change on every
// re-import even when the design is identical, so they can never be part of the
// canonical form:
//   id  — Figma node id, reassigned on import
//   key — publish key, only exists once published and differs per file
const VOLATILE_NODE_FIELDS = ['id', 'key'];

/** Round a float to 2dp so renderer noise (0.30000000000000004) can't diff. */
function round2(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : v;
}

function roundDeep(v) {
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = roundDeep(v[k]);
    return out;
  }
  return round2(v);
}

/**
 * Canonicalize one walker node tree. Pure, recursive.
 * Child ORDER is preserved — for an auto-layout frame the order of children IS
 * the design (it decides what renders left-to-right), so sorting it would erase
 * real information and hide real regressions.
 */
export function normalizeNode(node) {
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const k of Object.keys(node).sort()) {
    if (VOLATILE_NODE_FIELDS.includes(k)) continue;
    if (k === 'kids') continue;   // appended last so trees read root-first
    out[k] = roundDeep(node[k]);
  }
  if (Array.isArray(node.kids)) out.kids = node.kids.map(normalizeNode);
  return out;
}

/**
 * Canonicalize one extracted page.
 * Top-level frames ARE sorted by name: they're independent artboards sitting
 * side by side on a canvas, and their array order reflects z-order/creation
 * order, which re-import legitimately does not preserve. Sorting them keeps a
 * roundtrip honest without losing design meaning. (Nested children are NOT
 * sorted — see normalizeNode.)
 */
export function normalizePage(page) {
  if (!page || typeof page !== 'object') return page;
  const frames = (page.frames || []).map(normalizeNode);
  frames.sort((a, b) => String(a.n).localeCompare(String(b.n)) || String(a.t).localeCompare(String(b.t)));
  const out = { name: page.name, nodeCount: page.nodeCount ?? 0, frames };
  // Incompleteness is signal, not noise: a page that only extracted at reduced
  // depth, or failed outright, must be visible in the contract — otherwise a
  // truncated snapshot silently looks like a clean one.
  if (page.reducedDepth != null) out.reducedDepth = page.reducedDepth;
  if (page.error) out.error = page.error;
  return out;
}

/**
 * Canonicalize the variable layer. resolveAliases() already does the important
 * half: it rewrites alias references from volatile variable IDs to
 * (name, collection) pairs, which is what makes token chains survive a
 * roundtrip. Here we only sort — collections and variables are unordered SETS
 * in Figma, so their array order carries no meaning and must not diff.
 */
export function normalizeVariables(variables = []) {
  const resolved = resolveAliases(variables);
  const cols = resolved.map(col => ({
    name: col.name,
    modes: [...(col.modes || [])].sort(),
    variables: [...(col.variables || [])]
      .map(v => ({ name: v.name, type: v.type, values: roundDeep(v.values || {}) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
  cols.sort((a, b) => a.name.localeCompare(b.name));
  return cols;
}

/**
 * Build the canonical snapshot from an `extraction`
 * ({ fileName, date, pages, variables }) — the same object `extract` already
 * assembles before generating markdown.
 *
 * `meta` holds provenance (file name, extraction date, and the SCOPE the
 * snapshot was taken with). It is intentionally EXCLUDED from diffing: a
 * snapshot taken today from a duplicated file must still compare equal,
 * otherwise the contract would fail for reasons that have nothing to do with
 * the design. The scope is recorded so `check` can warn when it is about to
 * compare a narrower or wider extraction against the contract — that mismatch
 * would otherwise show up as an avalanche of phantom drift.
 */
export function buildSnapshot(extraction = {}, { scope = null } = {}) {
  return {
    version: SNAPSHOT_VERSION,
    meta: {
      file: extraction.fileName ?? null,
      extractedAt: extraction.date ?? null,
      scope: normalizeScope(scope),
    },
    pages: (extraction.pages || []).map(normalizePage)
      .sort((a, b) => a.name.localeCompare(b.name)),
    variables: normalizeVariables(extraction.variables || []),
  };
}

/**
 * Canonical form of the extraction scope. Pure. Normalized (sorted, lower-cased
 * page filters) so an equivalent scope written differently still compares equal.
 */
export function normalizeScope(scope) {
  if (!scope) return null;
  const list = (v) => {
    if (!v) return null;
    const arr = Array.isArray(v) ? v : String(v).split(',');
    const out = arr.map(s => String(s).trim().toLowerCase()).filter(Boolean).sort();
    return out.length ? out : null;
  };
  return {
    pages: list(scope.pages),
    sections: list(scope.sections),
    selection: !!scope.selection,
    resolveRemote: !!scope.resolveRemote,
  };
}

/** True when two scopes would extract the same slice of the file. Pure. */
export function sameScope(a, b) {
  return JSON.stringify(normalizeScope(a)) === JSON.stringify(normalizeScope(b));
}

/**
 * Deterministic JSON: object keys sorted at every level, so two structurally
 * equal snapshots serialize to identical bytes and `diff`/git show real changes
 * only. Arrays keep their order (it is meaningful — see normalizeNode).
 */
export function stableStringify(value, indent = 2) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value), null, indent) + '\n';
}

// Human-readable path segment for an array element. Named nodes (`n`) and named
// records (`name`) are addressed by name rather than index, so a diff reads
// `pages/Components/frames/Button/h` instead of `pages[1]/frames[7]/h` — the
// former survives reordering and tells you what broke.
function segFor(item, index) {
  if (item && typeof item === 'object') {
    if (typeof item.n === 'string') return item.n;
    if (typeof item.name === 'string') return item.name;
  }
  return `[${index}]`;
}

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function pushDiff(out, path, base, next, limit) {
  if (out.length >= limit) return;
  const kind = base === undefined ? 'added' : next === undefined ? 'removed' : 'changed';
  out.push({ path, kind, base, next });
}

function walkDiff(base, next, path, out, limit) {
  if (out.length >= limit) return;

  if (Array.isArray(base) && Array.isArray(next)) {
    // Match array elements by NAME when they carry one — otherwise a single
    // inserted child would report every following sibling as changed, burying
    // the one real difference in noise.
    const named = [...base, ...next].every(i => isObj(i) && (typeof i.n === 'string' || typeof i.name === 'string'));
    if (named) {
      const keyOf = i => `${i.n ?? i.name} ${i.t ?? ''}`;
      const bMap = new Map(base.map((i, ix) => [`${keyOf(i)}#${base.slice(0, ix).filter(x => keyOf(x) === keyOf(i)).length}`, i]));
      const nMap = new Map(next.map((i, ix) => [`${keyOf(i)}#${next.slice(0, ix).filter(x => keyOf(x) === keyOf(i)).length}`, i]));
      for (const [k, bv] of bMap) {
        const seg = segFor(bv, 0);
        if (!nMap.has(k)) pushDiff(out, `${path}/${seg}`, bv, undefined, limit);
        else walkDiff(bv, nMap.get(k), `${path}/${seg}`, out, limit);
      }
      for (const [k, nv] of nMap) {
        if (!bMap.has(k)) pushDiff(out, `${path}/${segFor(nv, 0)}`, undefined, nv, limit);
      }
      return;
    }
    if (base.length !== next.length) { pushDiff(out, path, base, next, limit); return; }
    for (let i = 0; i < base.length; i++) walkDiff(base[i], next[i], `${path}/${segFor(base[i], i)}`, out, limit);
    return;
  }

  if (isObj(base) && isObj(next)) {
    for (const k of new Set([...Object.keys(base), ...Object.keys(next)])) {
      if (!(k in base)) { pushDiff(out, `${path}/${k}`, undefined, next[k], limit); continue; }
      if (!(k in next)) { pushDiff(out, `${path}/${k}`, base[k], undefined, limit); continue; }
      walkDiff(base[k], next[k], `${path}/${k}`, out, limit);
    }
    return;
  }

  if (JSON.stringify(base) !== JSON.stringify(next)) pushDiff(out, path, base, next, limit);
}

/**
 * Compare two canonical snapshots. Returns { equal, diffs, truncated }.
 * `meta` is skipped (provenance, not design — see buildSnapshot).
 * `limit` caps the report so a wholesale change can't print 10k lines.
 */
export function diffSnapshots(base, next, { limit = 200 } = {}) {
  const out = [];
  const strip = (s) => {
    const { meta, ...rest } = s || {};
    return rest;
  };
  walkDiff(strip(base), strip(next), '', out, limit);
  return { equal: out.length === 0, diffs: out, truncated: out.length >= limit };
}

/** One diff entry → a single readable line. Pure (used by the CLI printer). */
export function formatDiff(d) {
  const short = (v) => {
    if (v === undefined) return '—';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  };
  const at = d.path.replace(/^\//, '') || '(root)';
  if (d.kind === 'added') return `+ ${at}: ${short(d.next)}`;
  if (d.kind === 'removed') return `- ${at}: ${short(d.base)}`;
  return `~ ${at}: ${short(d.base)} → ${short(d.next)}`;
}

/**
 * Group diffs by top-level area so the CLI can lead with a one-line verdict
 * ("3 changes in variables, 1 in pages") before the detail. Pure.
 */
export function summarizeDiff(diffs = []) {
  const by = {};
  for (const d of diffs) {
    const area = (d.path.replace(/^\//, '').split('/')[0]) || 'root';
    by[area] = (by[area] || 0) + 1;
  }
  return by;
}
