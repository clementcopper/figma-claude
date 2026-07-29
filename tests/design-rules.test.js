// Tests for the rule layer (src/lib/design-rules.js).
//
// These encode the promise the rules make: the verdict is arithmetic. Every
// test states a concrete defect (a missing variant, a hardcoded colour, a lost
// hover state) and asserts the checker catches it WITHOUT anyone looking at a
// picture.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  findComponentSets, parseVariantName, countTokenBinding, collectTransitions,
  generateRule, ruleToYaml, ruleFromYaml, checkRule, checkRules, axesOf,
  auditFor, evidenceFor,
} from '../src/lib/design-rules.js';
import { resolveBoundVars, UNRESOLVED_VAR } from '../src/design-extract.js';

// A 4-variant Button: size × state, every fill bound to a token, hover wired up.
const variant = (name, { h = 32, fill = '#0969da', bound = 'semantic:btn/bg' } = {}) => ({
  t: 'COMPONENT', n: name, w: 80, h,
  fills: [fill],
  ...(bound ? { bv: { fills: [bound] } } : {}),
});

const buttonSet = (over = {}) => ({
  t: 'COMPONENT_SET', n: 'Button', w: 300, h: 120, kidCount: 4,
  kids: [
    variant('size=medium, state=rest'),
    { ...variant('size=medium, state=hover'), rx: [{ on: 'ON_HOVER', do: 'NODE', to: 'size=medium, state=rest', nav: 'CHANGE_TO' }] },
    variant('size=small, state=rest', { h: 24 }),
    variant('size=small, state=hover', { h: 24 }),
  ],
  ...over,
});

const extractionOf = (setNode) => ({
  pages: [{ name: 'Components', nodeCount: 5, frames: [{ t: 'FRAME', n: 'Wrapper', kids: [setNode] }] }],
});

describe('parseVariantName', () => {
  test('parses a multi-axis variant name', () => {
    assert.deepEqual(parseVariantName('size=medium, state=hover'), { size: 'medium', state: 'hover' });
  });
  test('returns null for a plain name', () => {
    assert.equal(parseVariantName('Button'), null);
  });
  test('keeps values that themselves contain "="', () => {
    assert.deepEqual(parseVariantName('label=a=b'), { label: 'a=b' });
  });
});

describe('axesOf — must read the FULL matrix, not the sampled variant', () => {
  // Regression guard for a real bug: the extraction samples one variant of a
  // set (a 144-variant Button would otherwise blow the payload). Deriving axes
  // from that single child reported a 1×1×1×1 matrix and produced a contract
  // that looked fine and enforced nothing.
  const primerButton = {
    t: 'COMPONENT_SET', n: 'Button', kidCount: 144,
    vp: {
      alignContent: { values: ['center', 'start'] },
      size: { values: ['small', 'medium', 'large'] },
      state: { values: ['rest', 'focus', 'hover', 'pressed', 'disabled', 'inactive'] },
      variant: { values: ['primary', 'secondary', 'danger', 'invisible'] },
    },
    kids: [{ t: 'COMPONENT', n: 'variant=primary, size=small, state=rest, alignContent=center', h: 28 }],
  };

  test('takes every axis value from variantGroupProperties', () => {
    const a = axesOf(primerButton);
    assert.deepEqual(Object.keys(a), ['alignContent', 'size', 'state', 'variant']);
    assert.equal(a.state.length, 6);
    assert.equal(Object.values(a).reduce((x, v) => x * v.length, 1), 144, 'the declared matrix must be 144');
  });

  test('the generated contract calls a complete 144-variant set exhaustive', () => {
    const r = generateRule({ node: primerButton, page: 'Page 1' });
    assert.equal(r.require.variants, 144);
    assert.equal(r.require.exhaustive, true);
  });

  test('and catches variants going missing from that set', () => {
    const contract = generateRule({ node: primerButton, page: 'Page 1' });
    const shrunk = { ...primerButton, kidCount: 140 };
    const res = checkRule(contract, { pages: [{ name: 'p', frames: [shrunk] }] });
    assert.equal(res.pass, false);
    assert.ok(res.results.some(x => !x.ok && /exhaustive: 140 of 144/.test(x.msg)), res.results.map(x => x.msg).join(' | '));
  });

  test('falls back to parsing child names when a set carries no vp', () => {
    assert.deepEqual(axesOf(buttonSet()), { size: ['medium', 'small'], state: ['hover', 'rest'] });
  });

  test('phrases a SURPLUS of variants sensibly instead of "-24 missing"', () => {
    const contract = generateRule({ node: primerButton, page: 'p' });
    contract.axes.state = contract.axes.state.filter(v => v !== 'inactive');   // 120 declared
    const res = checkRule(contract, { pages: [{ name: 'p', frames: [primerButton] }] });
    assert.equal(res.pass, false);
    const line = res.results.find(x => !x.ok && /exhaustive/.test(x.msg));
    assert.match(line.msg, /144 variant\(s\) but the contract's axes only describe 120 — 24 unaccounted for/);
    assert.doesNotMatch(line.msg, /-\d+ missing/);
  });

  test('says so when a set gained an axis the contract never agreed to', () => {
    const contract = generateRule({ node: primerButton, page: 'p' });
    const widened = { ...primerButton, vp: { ...primerButton.vp, tone: { values: ['loud'] } } };
    const res = checkRule(contract, { pages: [{ name: 'p', frames: [widened] }] });
    assert.equal(res.pass, false);
    assert.ok(res.results.some(x => !x.ok && /axis "tone": present in the file but not in the contract/.test(x.msg)));
  });
});

describe('findComponentSets', () => {
  test('finds sets nested anywhere in the page tree', () => {
    const found = findComponentSets(extractionOf(buttonSet()));
    assert.equal(found.length, 1);
    assert.equal(found[0].node.n, 'Button');
    assert.equal(found[0].page, 'Components');
  });
});

describe('countTokenBinding', () => {
  test('counts a fully token-bound component as fully bound', () => {
    const b = countTokenBinding(buttonSet());
    assert.equal(b.fills.total, 4);
    assert.equal(b.fills.bound, 4);
    assert.deepEqual(b.fills.raw, []);
  });

  test('reports hardcoded colours with the node that carries them', () => {
    const set = buttonSet();
    set.kids[0] = variant('size=medium, state=rest', { fill: '#ff0000', bound: null });
    const b = countTokenBinding(set);
    assert.equal(b.fills.bound, 3);
    assert.deepEqual(b.fills.raw, [{ node: 'size=medium, state=rest', value: '#ff0000' }]);
  });

  test('does NOT count a binding whose token could not be named', () => {
    // A binding into an uncaptured library cannot be verified, so claiming it
    // is bound would be a claim the contract cannot back up.
    const set = buttonSet();
    set.kids[0].bv = { fills: [UNRESOLVED_VAR] };
    const b = countTokenBinding(set);
    assert.equal(b.fills.bound, 3);
  });

  test('ignores gradients and images (not colour-token decisions)', () => {
    const set = { t: 'COMPONENT_SET', n: 'X', kids: [{ t: 'COMPONENT', n: 'a', fills: ['GRADIENT_LINEAR'] }] };
    assert.equal(countTokenBinding(set).fills.total, 0);
  });
});

describe('collectTransitions', () => {
  test('captures the state machine as stable, sorted entries', () => {
    const t = collectTransitions(buttonSet());
    assert.equal(t.length, 1);
    assert.deepEqual(t[0], { from: 'size=medium, state=hover', on: 'ON_HOVER', to: 'size=medium, state=rest', do: 'NODE' });
  });

  test('sorts so that reaction ORDER cannot cause drift', () => {
    const mk = (order) => ({ t: 'COMPONENT_SET', n: 'S', kids: [{ t: 'COMPONENT', n: 'v', rx: order }] });
    const a = collectTransitions(mk([{ on: 'ON_CLICK', to: 'x' }, { on: 'ON_HOVER', to: 'y' }]));
    const b = collectTransitions(mk([{ on: 'ON_HOVER', to: 'y' }, { on: 'ON_CLICK', to: 'x' }]));
    assert.deepEqual(a, b);
  });
});

describe('generateRule', () => {
  const rule = () => generateRule({ node: buttonSet(), page: 'Components' });

  test('derives the axes and their values from the variant names', () => {
    assert.deepEqual(rule().axes, { size: ['medium', 'small'], state: ['hover', 'rest'] });
  });

  test('demands exhaustiveness only when the file is exhaustive today', () => {
    assert.equal(rule().require.exhaustive, true, '2×2 = 4 variants present');
    const partial = buttonSet();
    partial.kids.pop();
    partial.kidCount = 3;
    assert.equal(generateRule({ node: partial, page: 'p' }).require.exhaustive, false);
  });

  test('locks in full token binding when it already holds', () => {
    // `scope` is recorded because a set's children are sampled — the rule must
    // not overpromise that all 4 variants were measured.
    assert.deepEqual(rule().require.tokens, { fills: 'bound', scope: 'sample-variant' });
  });

  test('records the current level instead of demanding an unfinished migration', () => {
    const partial = buttonSet();
    partial.kids[0] = variant('size=medium, state=rest', { fill: '#ff0000', bound: null });
    const r = generateRule({ node: partial, page: 'p' });
    assert.deepEqual(r.require.tokens, { fills: { minBound: 3 }, scope: 'sample-variant' });
  });

  test('omits the sampling caveat for a single-variant component', () => {
    const single = { t: 'COMPONENT_SET', n: 'Solo', kidCount: 1, kids: [variant('size=medium')] };
    assert.deepEqual(generateRule({ node: single, page: 'p' }).require.tokens, { fills: 'bound' });
  });

  test('captures sample geometry and the state machine', () => {
    const r = rule();
    assert.deepEqual(r.require.geometry, { 'size=medium, state=rest': { height: 32, tolerance: 2 } });
    assert.equal(r.require.states.length, 1);
    assert.equal(r.require.states[0].on, 'ON_HOVER');
  });
});

describe('yaml roundtrip', () => {
  test('a generated rule survives yaml → text → yaml unchanged', () => {
    const r = generateRule({ node: buttonSet(), page: 'Components' });
    const back = ruleFromYaml(ruleToYaml(r));
    assert.deepEqual(back, r);
  });

  test('the file carries a header explaining it is the source of truth', () => {
    assert.match(ruleToYaml(generateRule({ node: buttonSet(), page: 'p' })), /source of truth/);
  });

  test('rejects malformed yaml with a readable message', () => {
    assert.throws(() => ruleFromYaml('\tnot: [valid', 'button.yaml'), /button\.yaml: invalid YAML/);
  });

  test('rejects a rule without a component name', () => {
    assert.throws(() => ruleFromYaml('require:\n  exists: true\n', 'x.yaml'), /missing required field "component"/);
  });
});

describe('checkRule — the defects it must catch', () => {
  const contract = () => generateRule({ node: buttonSet(), page: 'Components' });

  test('passes against the file it was generated from', () => {
    const r = checkRule(contract(), extractionOf(buttonSet()));
    assert.equal(r.pass, true, r.results.filter(x => !x.ok).map(x => x.msg).join(' | '));
  });

  test('catches a deleted component with one clear cause', () => {
    const r = checkRule(contract(), { pages: [{ name: 'p', frames: [] }] });
    assert.equal(r.pass, false);
    assert.equal(r.results.length, 1);
    assert.match(r.results[0].msg, /no component set named "Button"/);
  });

  test('catches a missing variant combination', () => {
    const partial = buttonSet();
    partial.kids = partial.kids.filter(k => k.n !== 'size=small, state=hover');
    partial.kidCount = 3;
    const r = checkRule(contract(), extractionOf(partial));
    assert.equal(r.pass, false);
    assert.ok(r.results.some(x => !x.ok && /exhaustive: 3 of 4/.test(x.msg)), r.results.map(x => x.msg).join(' | '));
  });

  test('catches a new axis value nobody agreed to', () => {
    const extended = buttonSet();
    extended.kids.push(variant('size=huge, state=rest'));
    extended.kidCount = 5;
    const r = checkRule(contract(), extractionOf(extended));
    assert.equal(r.pass, false);
    assert.ok(r.results.some(x => !x.ok && /unexpected huge/.test(x.msg)));
  });

  test('catches a hardcoded colour replacing a token', () => {
    const drifted = buttonSet();
    drifted.kids[0] = variant('size=medium, state=rest', { fill: '#ff0000', bound: null });
    const r = checkRule(contract(), extractionOf(drifted));
    assert.equal(r.pass, false);
    assert.ok(r.results.some(x => !x.ok && /tokens\.fills: 1 of 4 not bound/.test(x.msg)), r.results.map(x => x.msg).join(' | '));
  });

  test('catches a size regression by NUMBER, not by eye', () => {
    const fat = buttonSet();
    fat.kids[0] = { ...fat.kids[0], h: 56 };
    const r = checkRule(contract(), extractionOf(fat));
    assert.equal(r.pass, false);
    assert.ok(r.results.some(x => !x.ok && /geometry.*56px, contract says 32px \(off 24px\)/.test(x.msg)));
  });

  test('accepts a sub-pixel difference inside the tolerance', () => {
    const nudged = buttonSet();
    nudged.kids[0] = { ...nudged.kids[0], h: 33 };
    assert.equal(checkRule(contract(), extractionOf(nudged)).pass, true);
  });

  test('catches a lost hover interaction (the state machine broke)', () => {
    const noHover = buttonSet();
    noHover.kids[1] = { ...noHover.kids[1], rx: undefined };
    const r = checkRule(contract(), extractionOf(noHover));
    assert.equal(r.pass, false);
    assert.ok(r.results.some(x => !x.ok && /state: missing .*ON_HOVER/.test(x.msg)));
  });

  test('catches token coverage sliding backwards on a partial migration', () => {
    const partial = buttonSet();
    partial.kids[0] = variant('size=medium, state=rest', { fill: '#ff0000', bound: null });
    const contractAtPartial = generateRule({ node: partial, page: 'p' });   // minBound: 3
    const worse = buttonSet();
    worse.kids[0] = variant('size=medium, state=rest', { fill: '#ff0000', bound: null });
    worse.kids[1] = { ...variant('size=medium, state=hover', { fill: '#00ff00', bound: null }), rx: partial.kids[1].rx };
    const r = checkRule(contractAtPartial, extractionOf(worse));
    assert.equal(r.pass, false);
    assert.ok(r.results.some(x => !x.ok && /token coverage regressed/.test(x.msg)));
  });
});

describe('full-variant audit — covering ALL variants, not just the sample', () => {
  // The extraction samples one child of a component set for payload reasons.
  // The audit aggregates every variant INSIDE Figma and returns counts, so a
  // 144-variant set costs the same payload as a 2-variant one. Without it,
  // "all fills bound" would only ever mean "the one variant we looked at".
  const set = () => ({
    t: 'COMPONENT_SET', n: 'Button', kidCount: 144,
    vp: { size: { values: ['small', 'large'] }, state: { values: ['rest', 'hover'] } },
    kids: [{ t: 'COMPONENT', n: 'size=small, state=rest', h: 28, fills: ['#0969da'], bv: { fills: ['semantic:btn/bg'] } }],
  });
  const audit = (over = {}) => ({
    page: 'Page 1', name: 'Button', variants: 144,
    fills: { total: 432, bound: 432, raw: [] },
    strokes: { total: 144, bound: 144, raw: [] },
    transitions: [
      { from: 'size=small, state=rest', on: 'ON_HOVER', to: 'size=small, state=hover', do: 'NODE' },
      { from: 'size=large, state=rest', on: 'ON_HOVER', to: 'size=large, state=hover', do: 'NODE' },
    ],
    tokens: ['btn/bg'],
    ...over,
  });
  const extraction = (a) => ({ pages: [{ name: 'Page 1', frames: [set()] }], ...(a ? { audit: [a] } : {}) });

  test('auditFor matches by component name and page', () => {
    assert.equal(auditFor(extraction(audit()), 'Button', 'Page 1').variants, 144);
    assert.equal(auditFor(extraction(audit()), 'Nope', 'Page 1'), null);
    assert.equal(auditFor(extraction(null), 'Button', 'Page 1'), null);
  });

  test('evidenceFor prefers the audit and marks the evidence complete', () => {
    const withAudit = evidenceFor(set(), audit());
    assert.equal(withAudit.complete, true);
    assert.equal(withAudit.binding.fills.total, 432, 'all variants, not the 1 sampled fill');
    const without = evidenceFor(set(), null);
    assert.equal(without.complete, false);
    assert.equal(without.binding.fills.total, 1);
  });

  test('the contract now claims all-variant coverage instead of sample-variant', () => {
    const r = generateRule({ node: set(), page: 'Page 1', audit: audit() });
    assert.deepEqual(r.require.tokens, { fills: 'bound', scope: 'all-variants' });
    assert.equal(r.require.variants, 144);
  });

  test('a hardcoded colour in ANY variant is caught, not just the sampled one', () => {
    // The sampled variant is still perfectly token-bound; the defect is in one
    // of the other 143. This is exactly what the old sample-only check missed.
    const contract = generateRule({ node: set(), page: 'Page 1', audit: audit() });
    const drifted = audit({ fills: { total: 432, bound: 431, raw: [{ node: 'size=large, state=hover', value: '#ff0000' }] } });
    const res = checkRule(contract, extraction(drifted));
    assert.equal(res.pass, false);
    assert.ok(res.results.some(x => !x.ok && /tokens\.fills: 1 of 432 not bound.*size=large, state=hover #ff0000/.test(x.msg)),
      res.results.map(x => x.msg).join(' | '));
  });

  test('captures transitions from every variant and dedupes repeats', () => {
    const repeated = audit({
      transitions: [
        { from: 'a', on: 'ON_HOVER', to: 'b', do: 'NODE' },
        { from: 'a', on: 'ON_HOVER', to: 'b', do: 'NODE' },
        { from: 'c', on: 'ON_CLICK', to: 'd', do: 'NODE' },
      ],
    });
    const r = generateRule({ node: set(), page: 'Page 1', audit: repeated });
    assert.equal(r.require.states.length, 2, 'the same promise repeated across variants is one promise');
  });

  test('catches a transition that only existed on a non-sampled variant', () => {
    const contract = generateRule({ node: set(), page: 'Page 1', audit: audit() });
    assert.equal(contract.require.states.length, 2);
    const lost = audit({ transitions: [{ from: 'size=small, state=rest', on: 'ON_HOVER', to: 'size=small, state=hover', do: 'NODE' }] });
    const res = checkRule(contract, extraction(lost));
    assert.equal(res.pass, false);
    assert.ok(res.results.some(x => !x.ok && /state: missing size=large, state=rest --ON_HOVER--> size=large, state=hover/.test(x.msg)));
  });

  test('refuses to pass an all-variant contract on sample-only evidence', () => {
    // Otherwise a green run would mean "one variant was fine", which is not
    // what the contract promises.
    const contract = generateRule({ node: set(), page: 'Page 1', audit: audit() });
    const res = checkRule(contract, extraction(null));
    assert.equal(res.pass, false);
    assert.ok(res.results.some(x => !x.ok && /only measured the sampled one/.test(x.msg)),
      res.results.map(x => x.msg).join(' | '));
  });

  test('still passes when the audit confirms the contract', () => {
    const contract = generateRule({ node: set(), page: 'Page 1', audit: audit() });
    const res = checkRule(contract, extraction(audit()));
    assert.equal(res.pass, true, res.results.filter(x => !x.ok).map(x => x.msg).join(' | '));
  });
});

describe('checkRules', () => {
  test('aggregates many contracts into one verdict', () => {
    const rules = [generateRule({ node: buttonSet(), page: 'Components' }), { component: 'Ghost', require: { exists: true } }];
    const res = checkRules(rules, extractionOf(buttonSet()));
    assert.equal(res.checked, 2);
    assert.equal(res.failed, 1);
    assert.equal(res.pass, false);
  });

  test('an empty rule set passes (nothing has been agreed yet)', () => {
    assert.equal(checkRules([], extractionOf(buttonSet())).pass, true);
  });
});

describe('bound-variable resolution feeding the rules', () => {
  test('walker ids become qualified token names, unknown ones stay unresolved', () => {
    const pages = [{ name: 'p', frames: [{ t: 'COMPONENT', n: 'a', fills: ['#fff'], bv: { fills: ['V:1'], itemSpacing: 'V:9' } }] }];
    const cols = [{ name: 'semantic', variables: [{ id: 'V:1', name: 'bg/default' }] }];
    const out = resolveBoundVars(pages, cols);
    assert.deepEqual(out[0].frames[0].bv, { fills: ['semantic:bg/default'], itemSpacing: UNRESOLVED_VAR });
  });

  test('leaves nodes without bindings untouched and does not mutate the input', () => {
    const pages = [{ name: 'p', frames: [{ t: 'FRAME', n: 'a', kids: [{ t: 'FRAME', n: 'b' }] }] }];
    const copy = JSON.parse(JSON.stringify(pages));
    const out = resolveBoundVars(pages, []);
    assert.deepEqual(pages, copy, 'input must not be mutated');
    assert.equal(out[0].frames[0].kids[0].n, 'b');
  });
});
