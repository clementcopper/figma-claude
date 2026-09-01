import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evalSilenceHint, formatEvalOutput } from '../src/lib/eval-output.js';

// Reported from the panel (FEEDBACK.md): a script ending in console.log(JSON.stringify(...))
// printed nothing and exited 0 — "a logging script and a broken connection look identical".

describe('evalSilenceHint', () => {
  it('says nothing when there is a value to print', () => {
    assert.strictEqual(evalSilenceHint('return 1', 1), null);
    assert.strictEqual(evalSilenceHint('return ""', ''), null, 'an empty string is still a result');
    assert.strictEqual(evalSilenceHint('return 0', 0), null);
    assert.strictEqual(evalSilenceHint('return false', false), null);
  });

  it('points at Figma\'s console when the code logged', () => {
    const hint = evalSilenceHint('console.log(JSON.stringify(styles))', undefined);
    assert.match(hint, /Figma/);
    assert.match(hint, /return/);
  });

  it('recognises the whole console family', () => {
    for (const call of ['console.info(x)', 'console.warn(x)', 'console.error(x)', 'console.table(x)']) {
      assert.match(evalSilenceHint(call, undefined), /Figma/, call);
    }
  });

  it('states the plain case when nothing was logged', () => {
    const hint = evalSilenceHint('const a = 1', undefined);
    assert.match(hint, /no value returned/);
    assert.doesNotMatch(hint, /Figma/, 'no console call, so no console advice');
  });

  it('is not fooled by the word console in a string', () => {
    const hint = evalSilenceHint('const s = "console.log is not called here"', null);
    assert.doesNotMatch(hint, /Figma/);
  });

  it('treats null like undefined', () => {
    assert.match(evalSilenceHint('console.log(1)', null), /Figma/);
  });
});

describe('formatEvalOutput', () => {
  it('prints a scalar as itself', () => {
    assert.deepStrictEqual(formatEvalOutput('return 1', 1), { text: '1', dim: false });
    assert.deepStrictEqual(formatEvalOutput('return ""', ''), { text: '', dim: false });
    assert.deepStrictEqual(formatEvalOutput('return false', false), { text: 'false', dim: false });
  });

  it('pretty-prints an object', () => {
    const out = formatEvalOutput('return {a:1}', { a: 1 });
    assert.strictEqual(out.dim, false);
    assert.strictEqual(out.text, '{\n  "a": 1\n}');
  });

  it('names the silence for a logging script, dimmed', () => {
    const out = formatEvalOutput('console.log(x)', undefined);
    assert.strictEqual(out.dim, true);
    assert.match(out.text, /^· /);
    assert.match(out.text, /Figma/);
  });

  // `run` printed the bare word "null" here while `eval` printed the hint — the drift that let
  // the console.log report come back a second time for a command that never got the fix.
  it('treats null as no value, not as the string "null"', () => {
    const out = formatEvalOutput('const a = 1', null);
    assert.strictEqual(out.dim, true);
    assert.notStrictEqual(out.text, 'null');
  });
});
