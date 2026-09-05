import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { a11yErrorOutput, a11yExitCode, parseLevel, touchSummary } from '../src/commands/a11y.js';

// `a11y … --json` printed a red chalk line on failure, so a consumer parsing stdout got
// neither JSON nor a clue; `check --json` already answers `{ ok: false, error }`.

describe('a11yErrorOutput', () => {
  it('is JSON under --json and a red line otherwise', () => {
    assert.deepStrictEqual(JSON.parse(a11yErrorOutput('Node not found', { json: true })), { ok: false, error: 'Node not found' });
    assert.match(a11yErrorOutput('Node not found', {}), /✗ Node not found/);
  });
});

// `a11y contrast` printed "✗ Fail: 1/5" and exited 0, so a CI gate had to parse the JSON;
// `check` exits 1 on any violation and `docs scripting-the-cli` lists a11y beside it.
describe('a11yExitCode', () => {
  it('is 1 when an element fails contrast, text or touch', () => {
    assert.strictEqual(a11yExitCode({ total: 5, failing: 1 }), 1);
    assert.strictEqual(a11yExitCode({ total: 5, failing: 0 }), 0);
    // `a11y text` counts errors and warnings instead of failing
    assert.strictEqual(a11yExitCode({ total: 3, errors: 1, warnings: 0 }), 1);
    assert.strictEqual(a11yExitCode({ total: 3, errors: 0, warnings: 2 }), 0);
  });
  it('is 1 for an audit with an error, 0 for warnings only', () => {
    assert.strictEqual(a11yExitCode({ score: 'C', issues: [{ severity: 'error' }] }), 1);
    assert.strictEqual(a11yExitCode({ score: 'B', issues: [{ severity: 'warning' }] }), 0);
    assert.strictEqual(a11yExitCode({ score: 'A+', issues: [] }), 0);
  });
});

// `--level AAAA` ran as AA with no word; `a11y vision --type banana` rejects.
describe('parseLevel', () => {
  it('accepts AA and AAA in any case', () => {
    assert.strictEqual(parseLevel('aa'), 'AA');
    assert.strictEqual(parseLevel('AAA'), 'AAA');
  });
  it('rejects anything else, naming the choices', () => {
    assert.throws(() => parseLevel('AAAA'), /Unknown level "AAAA"\. Use: AA, AAA/);
  });
});

// `a11y touch` on a 20×20 frame with no "button" in its name printed "Pass: 0/0" and "All
// interactive elements meet minimum size!" — the check had found nothing to check.
describe('touchSummary', () => {
  it('says that nothing was found, and how it looks, when total is 0', () => {
    assert.match(touchSummary({ total: 0, issues: [] }), /0 interactive elements found/);
    assert.match(touchSummary({ total: 0, issues: [] }), /INSTANCE|COMPONENT/);
    assert.match(touchSummary({ total: 0, issues: [] }), /button\|btn/);
  });
  it('keeps the pass line when something was checked and nothing failed', () => {
    assert.match(touchSummary({ total: 2, issues: [] }), /All 2 interactive elements meet/);
  });
  it('is empty when there are issues (they are listed instead)', () => {
    assert.strictEqual(touchSummary({ total: 2, issues: [{}] }), '');
  });
});

// `a11y vision 9999:9999 --json` said "Select a frame or provide a node ID" although one was given.
describe('a11y vision missing-node message', () => {
  it('names the id like its five siblings', () => {
    const src = readFileSync(new URL('../src/commands/a11y.js', import.meta.url), 'utf8');
    const vision = src.slice(src.indexOf(".command('vision"), src.indexOf(".command('touch"));
    assert.match(vision, /'Node not found: ' \+ targetId/);
  });
});
