// The ROUNDTRIP proof.
//
// `extract` writes a DESIGN.md and `import` reads it back. Between those two
// steps the entire token layer is re-encoded as markdown — and until now
// nothing verified that the encoding is LOSSLESS. When it isn't, the failure is
// silent and expensive: tokens re-import with no value and every affected
// surface renders white, which only a human notices, days later, by looking.
//
// This module closes that loop mechanically: take the live extraction, run it
// through the real writer AND the real reader, then compare the token layer
// that comes out with the one that went in. Any loss is reported with the exact
// collection, token and mode. No model, no eyeballs.

import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateDesignMd, resolveAliases, buildVariableTokens } from '../design-extract.js';
import { parseDesignMd } from '../design-md.js';

/** A token value → a comparable string. Alias objects compare by target. Pure. */
export function valueKey(v) {
  if (v == null) return '∅';
  if (typeof v === 'object') {
    if ('alias' in v) return `→${v.alias}${v.collection ? `@${v.collection}` : ''}`;
    return JSON.stringify(v);
  }
  return String(v);
}

/**
 * Compare the token layer that went INTO the markdown with the one that came
 * back OUT. Pure — both sides are plain objects in buildVariableTokens shape:
 *   { [collection]: { modes: [...], variables: { [name]: { type, values } } } }
 * Returns a list of losses, most specific first.
 */
export function compareTokenLayers(before = {}, after = {}) {
  const losses = [];
  for (const [col, spec] of Object.entries(before)) {
    const back = after[col];
    if (!back) {
      losses.push({ kind: 'collection-missing', collection: col, detail: `${Object.keys(spec.variables || {}).length} variable(s) lost` });
      continue;
    }
    const beforeModes = spec.modes || [];
    const afterModes = back.modes || [];
    if (JSON.stringify(beforeModes) !== JSON.stringify(afterModes)) {
      losses.push({ kind: 'modes-changed', collection: col, detail: `${JSON.stringify(beforeModes)} → ${JSON.stringify(afterModes)}` });
    }
    for (const [name, v] of Object.entries(spec.variables || {})) {
      const bv = (back.variables || {})[name];
      if (!bv) { losses.push({ kind: 'variable-missing', collection: col, variable: name }); continue; }
      if (bv.type !== v.type) losses.push({ kind: 'type-changed', collection: col, variable: name, detail: `${v.type} → ${bv.type}` });
      for (const [mode, val] of Object.entries(v.values || {})) {
        const got = (bv.values || {})[mode];
        const a = valueKey(val);
        const b = valueKey(got);
        if (a !== b) losses.push({ kind: 'value-changed', collection: col, variable: name, mode, detail: `${a} → ${b}` });
      }
    }
  }
  return losses;
}

/**
 * Run a live extraction through write → read and report what did not survive.
 * `writeMd`/`readMd` are injectable so tests can drive the comparison without
 * touching the filesystem; by default the REAL generator and the REAL importer
 * parser are used, which is the whole point — a mock of either would prove
 * nothing about the actual roundtrip.
 */
export function verifyRoundtrip(extraction, {
  write = generateDesignMd,
  read = parseDesignMd,
  tmp = join(tmpdir(), `figma-roundtrip-${process.pid}-${process.hrtime.bigint()}.md`),
} = {}) {
  const collections = extraction.variables || [];
  const before = buildVariableTokens(resolveAliases(collections));
  const varCount = Object.values(before).reduce((a, c) => a + Object.keys(c.variables || {}).length, 0);

  if (!varCount) {
    return { ok: true, skipped: true, reason: 'this file defines no variables — nothing to roundtrip', varCount: 0, losses: [] };
  }

  const md = write(extraction, { sections: ['identity', 'variables', 'tokens'] });
  let parsed;
  try {
    writeFileSync(tmp, md);
    parsed = read(tmp);
  } finally {
    try { unlinkSync(tmp); } catch { /* best effort */ }
  }

  const after = (parsed && parsed.tokens && parsed.tokens.variables) || {};
  const losses = compareTokenLayers(before, after);
  return { ok: losses.length === 0, skipped: false, varCount, collections: Object.keys(before).length, losses };
}

/** One loss → a readable line. Pure. */
export function formatRoundtripLoss(l) {
  const at = [l.collection, l.variable, l.mode].filter(Boolean).join(' › ');
  const what = {
    'collection-missing': 'collection did not survive',
    'modes-changed': 'modes changed',
    'variable-missing': 'variable did not survive',
    'type-changed': 'type changed',
    'value-changed': 'value changed',
  }[l.kind] || l.kind;
  return `${at}: ${what}${l.detail ? ` (${l.detail})` : ''}`;
}
