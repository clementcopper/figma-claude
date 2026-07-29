// The RULE layer: per-component YAML contracts, generated from the live file
// and enforced by arithmetic.
//
// The snapshot (design-snapshot.js) answers "did anything change?". That is
// necessary but blunt — every intentional edit turns it red. Rules answer the
// sharper question: "is this component still BUILT CORRECTLY?" — is the variant
// matrix complete, are the colours bound to tokens instead of hardcoded, does
// the hover state still exist, is the medium size still 32px.
//
// A rule file is authored ONCE (generated from the current file, reviewed by a
// human as a diff) and from then on the verdict is a computation. Nothing here
// touches Figma or a model: input is the extraction, output is pass/fail.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { UNRESOLVED_VAR } from '../design-extract.js';

/** Every node in a walker subtree, root included. Pure. */
function* walkNodes(node) {
  if (!node || typeof node !== 'object') return;
  yield node;
  for (const k of node.kids || []) yield* walkNodes(k);
}

/** All component sets across an extraction, with the page they live on. Pure. */
export function findComponentSets(extraction = {}) {
  const out = [];
  for (const page of extraction.pages || []) {
    for (const frame of page.frames || []) {
      for (const n of walkNodes(frame)) {
        if (n.t === 'COMPONENT_SET') out.push({ node: n, page: page.name });
      }
    }
  }
  return out;
}

/**
 * Parse a variant name ("size=medium, state=hover") into { size, medium }.
 * Returns null when the name is not in variant form. Pure.
 */
export function parseVariantName(name) {
  if (typeof name !== 'string' || !name.includes('=')) return null;
  const out = {};
  for (const part of name.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) return null;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) return null;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The variant axes of a component set, as { axis: [values…] }.
 *
 * AUTHORITATIVE SOURCE is `vp` (Figma's variantGroupProperties), which the
 * walker captures in full. The variant CHILDREN are deliberately sampled — a
 * 144-variant set would otherwise blow the extraction payload — so deriving
 * axes from the sampled child would report a 1×1×1×1 matrix and silently turn
 * the contract into a lie. Parsing child names is only the fallback for sets
 * that carry no vp. Pure.
 */
export function axesOf(node) {
  const out = {};
  if (node && node.vp && typeof node.vp === 'object') {
    for (const k of Object.keys(node.vp).sort()) {
      const vals = node.vp[k] && Array.isArray(node.vp[k].values) ? node.vp[k].values : null;
      if (vals && vals.length) out[k] = [...vals].sort();
    }
    if (Object.keys(out).length) return out;
  }
  const acc = {};
  for (const v of node?.kids || []) {
    const a = parseVariantName(v.n);
    if (!a) continue;
    for (const [k, val] of Object.entries(a)) (acc[k] ||= new Set()).add(val);
  }
  for (const k of Object.keys(acc).sort()) out[k] = [...acc[k]].sort();
  return out;
}

// A fill/stroke entry the walker emitted that is a real colour decision. Paint
// types it could not resolve to hex (GRADIENT/IMAGE) are not token candidates.
const isColorPaint = (p) => typeof p === 'string' && p.startsWith('#');

/**
 * Count colour decisions in a subtree and how many are bound to a variable.
 * `bv.fills` / `bv.strokes` come from the walker (already resolved to token
 * names). Pure. Returns { fills: {total, bound, raw:[…]}, strokes: {…} }.
 */
export function countTokenBinding(root) {
  const stat = () => ({ total: 0, bound: 0, raw: [] });
  const out = { fills: stat(), strokes: stat() };
  for (const n of walkNodes(root)) {
    for (const kind of ['fills', 'strokes']) {
      const paints = (n[kind] || []).filter(isColorPaint);
      if (!paints.length) continue;
      const bound = (n.bv && n.bv[kind]) || [];
      out[kind].total += paints.length;
      // A binding only counts when the target could be NAMED — an unresolved
      // binding means the token lives in a library this export never saw, so
      // claiming it is bound would be a claim we cannot check.
      const namedBound = bound.filter(b => b && b !== UNRESOLVED_VAR).length;
      out[kind].bound += Math.min(namedBound, paints.length);
      if (namedBound < paints.length) {
        for (const p of paints.slice(namedBound)) out[kind].raw.push({ node: n.n, value: p });
      }
    }
  }
  return out;
}

/** All prototype transitions in a subtree, as stable "on → to" strings. Pure. */
export function collectTransitions(root) {
  const out = [];
  for (const n of walkNodes(root)) {
    for (const r of n.rx || []) {
      out.push({ from: n.n, on: r.on, to: r.to ?? null, do: r.do });
    }
  }
  // Sorted: reaction order is not a design decision and must not cause drift.
  return out.sort((a, b) => `${a.from}|${a.on}|${a.to}`.localeCompare(`${b.from}|${b.on}|${b.to}`));
}

/**
 * Generate a rule contract for one component set from the live extraction.
 * The generated file is a DESCRIPTION of what is true today — a human reviews
 * it once and it becomes the contract.
 */
export function generateRule({ node, page }) {
  const variants = (node.kids || []);
  const axisObj = axesOf(node);
  const declared = Object.keys(axisObj).length
    ? Object.values(axisObj).reduce((a, vals) => a * vals.length, 1)
    : 0;
  const variantCount = node.kidCount ?? variants.length;

  const binding = countTokenBinding(node);
  const fullyBound = binding.fills.total > 0 && binding.fills.bound === binding.fills.total;

  const rule = {
    component: node.n,
    page,
    require: {
      exists: true,
      variants: variantCount,
    },
  };
  if (Object.keys(axisObj).length) {
    rule.axes = axisObj;
    // Only demand exhaustiveness when the file actually IS exhaustive today —
    // generating a rule the source already violates would be noise, not a
    // contract.
    rule.require.exhaustive = Object.keys(axisObj).length > 0 && declared === variantCount;
  }
  // Same principle for tokens: only lock in "everything is bound" when that is
  // true right now. Otherwise record the current level so the contract can
  // catch REGRESSION without demanding an unfinished migration be finished.
  if (binding.fills.total) {
    rule.require.tokens = fullyBound ? { fills: 'bound' } : { fills: { minBound: binding.fills.bound } };
    // Be explicit about what was measured: the extraction samples ONE variant
    // of a set, so this rule covers that variant's subtree, not all 144. Saying
    // so in the file beats a contract that quietly overpromises.
    if (variantCount > 1) rule.require.tokens.scope = 'sample-variant';
  }
  // Geometry of the sample variant: the number that catches "the rebuild is too
  // tall" without anyone eyeballing a screenshot.
  const sample = variants[0];
  if (sample && sample.h != null) {
    rule.require.geometry = { [sample.n]: { height: sample.h, tolerance: 2 } };
  }
  const transitions = collectTransitions(node);
  if (transitions.length) {
    rule.require.states = transitions.map(t => ({ from: t.from, on: t.on, to: t.to }));
  }
  return rule;
}

/** Rule object → YAML text with a short explanatory header. Pure. */
export function ruleToYaml(rule) {
  const header = [
    `# Contract for "${rule.component}" — generated by \`figma-cli rules gen\`.`,
    '# Reviewed once by a human, enforced from then on by `figma-cli check`.',
    '# Edit freely: this file is the source of truth, not the Figma file.',
    '',
  ].join('\n');
  return header + stringifyYaml(rule);
}

/** YAML text → rule object. Throws a readable error on malformed input. Pure. */
export function ruleFromYaml(text, label = 'rule') {
  let parsed;
  try {
    parsed = parseYaml(text);
  } catch (e) {
    throw new Error(`${label}: invalid YAML — ${e.message}`);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error(`${label}: expected a YAML mapping`);
  if (!parsed.component) throw new Error(`${label}: missing required field "component"`);
  return parsed;
}

const ok = (msg) => ({ ok: true, msg });
const fail = (msg) => ({ ok: false, msg });

/**
 * Enforce one rule against an extraction. Returns { component, pass, results }.
 * Every result is a single mechanical assertion — the whole point is that a
 * human reading the output never has to judge, only read.
 */
export function checkRule(rule, extraction) {
  const results = [];
  const sets = findComponentSets(extraction);
  const found = sets.find(s => s.node.n === rule.component)
    || sets.find(s => s.node.n.toLowerCase() === String(rule.component).toLowerCase());

  if (!found) {
    // A component that vanished fails everything else by definition; reporting
    // one clear cause beats a cascade of confusing sub-failures.
    results.push(fail(`exists: no component set named "${rule.component}" in the extraction`));
    return { component: rule.component, pass: false, results };
  }
  results.push(ok(`exists: found on page "${found.page}"`));

  const node = found.node;
  const req = rule.require || {};
  const variants = node.kids || [];
  const variantCount = node.kidCount ?? variants.length;

  if (req.variants != null) {
    const good = variantCount === req.variants;
    results.push(good ? ok(`variants: ${variantCount}`) : fail(`variants: expected ${req.variants}, found ${variantCount}`));
  }

  if (rule.axes) {
    const present = axesOf(node);
    for (const [axis, values] of Object.entries(rule.axes)) {
      const got = present[axis];
      if (!got) { results.push(fail(`axis "${axis}": missing entirely`)); continue; }
      const missing = values.filter(v => !got.includes(v));
      const extra = got.filter(v => !values.includes(v));
      if (!missing.length && !extra.length) results.push(ok(`axis "${axis}": ${values.join(', ')}`));
      else results.push(fail(`axis "${axis}": ${[missing.length ? `missing ${missing.join(', ')}` : null, extra.length ? `unexpected ${extra.join(', ')}` : null].filter(Boolean).join('; ')}`));
    }
    for (const axis of Object.keys(present)) {
      if (!(axis in rule.axes)) results.push(fail(`axis "${axis}": present in the file but not in the contract`));
    }
    if (req.exhaustive) {
      // Coverage is counted against how many variants the SET actually holds
      // (kidCount), because the extraction samples the children — enumerating
      // them would only ever see one.
      const declared = Object.values(rule.axes).reduce((a, v) => a * v.length, 1);
      if (variantCount === declared) {
        results.push(ok(`exhaustive: all ${declared} combination(s) present`));
      } else if (variantCount < declared) {
        results.push(fail(`exhaustive: ${variantCount} of ${declared} combination(s) present — ${declared - variantCount} missing`));
      } else {
        // More variants than the axes can produce: the set gained values the
        // contract does not list. Saying "-24 missing" here would be nonsense.
        results.push(fail(`exhaustive: ${variantCount} variant(s) but the contract's axes only describe ${declared} — ${variantCount - declared} unaccounted for`));
      }
    }
  }

  if (req.tokens) {
    const binding = countTokenBinding(node);
    for (const kind of ['fills', 'strokes']) {
      const want = req.tokens[kind];
      if (want == null) continue;
      const b = binding[kind];
      if (want === 'bound') {
        const good = b.total === b.bound;
        results.push(good
          ? ok(`tokens.${kind}: all ${b.total} bound to variables`)
          : fail(`tokens.${kind}: ${b.total - b.bound} of ${b.total} not bound (e.g. ${b.raw.slice(0, 3).map(r => `${r.node} ${r.value}`).join(', ')})`));
      } else if (want && typeof want === 'object' && want.minBound != null) {
        const good = b.bound >= want.minBound;
        results.push(good
          ? ok(`tokens.${kind}: ${b.bound} bound (>= ${want.minBound})`)
          : fail(`tokens.${kind}: ${b.bound} bound, contract requires at least ${want.minBound} — token coverage regressed`));
      }
    }
  }

  if (req.geometry) {
    for (const [variantName, spec] of Object.entries(req.geometry)) {
      const v = variants.find(x => x.n === variantName);
      if (!v) { results.push(fail(`geometry "${variantName}": variant not found`)); continue; }
      const tol = spec.tolerance ?? 2;
      for (const dim of ['height', 'width']) {
        if (spec[dim] == null) continue;
        const actual = dim === 'height' ? v.h : v.w;
        const off = Math.abs((actual ?? 0) - spec[dim]);
        results.push(off <= tol
          ? ok(`geometry "${variantName}".${dim}: ${actual}px`)
          : fail(`geometry "${variantName}".${dim}: ${actual}px, contract says ${spec[dim]}px (off ${off}px)`));
      }
    }
  }

  if (req.states) {
    const actual = collectTransitions(node);
    const key = (t) => `${t.from}|${t.on}|${t.to}`;
    const have = new Set(actual.map(key));
    for (const want of req.states) {
      const k = key(want);
      results.push(have.has(k)
        ? ok(`state: ${want.from} --${want.on}--> ${want.to}`)
        : fail(`state: missing ${want.from} --${want.on}--> ${want.to}`));
    }
  }

  return { component: rule.component, pass: results.every(r => r.ok), results };
}

/** Enforce many rules. Returns { pass, checked, failed, reports }. */
export function checkRules(rules = [], extraction = {}) {
  const reports = rules.map(r => checkRule(r, extraction));
  return {
    pass: reports.every(r => r.pass),
    checked: reports.length,
    failed: reports.filter(r => !r.pass).length,
    reports,
  };
}
