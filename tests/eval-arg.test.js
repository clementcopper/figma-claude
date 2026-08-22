import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evalArg } from '../src/lib/eval-arg.js';

// The same parse `figmaUse` does, so the test proves the round trip rather than the format.
function parseLikeFigmaUse(arg) {
  const m = arg.match(/^eval\s+"(.+)"$/s) || arg.match(/^eval\s+'(.+)'$/s);
  return m ? m[1].replace(/\\"/g, '"') : null;
}

describe('evalArg', () => {
  it('brings single-line code through unchanged', () => {
    const code = 'figma.currentPage.name';
    assert.strictEqual(parseLikeFigmaUse(evalArg(code)), code);
  });

  it('keeps the newlines, so a // comment cannot eat the next statement', () => {
    // The flattened version of this cost 60049ms and returned null.
    const code = '(async () => {\n// pick the node\nconst n = figma.currentPage;\nreturn n.name;\n})()';
    const back = parseLikeFigmaUse(evalArg(code));
    assert.strictEqual(back, code);
    assert.ok(back.includes('\n'), 'flattened again');
    assert.ok(back.split('\n').length === 5);
  });

  it('survives double quotes in the code', () => {
    const code = 'await figma.getNodeByIdAsync("1954:37617")';
    assert.strictEqual(parseLikeFigmaUse(evalArg(code)), code);
  });

  it('survives quotes and newlines together', () => {
    const code = 'const id = "I2058:20351;2054:20325";\n// nested\nreturn id;';
    assert.strictEqual(parseLikeFigmaUse(evalArg(code)), code);
  });

  it('leaves single quotes alone', () => {
    const code = "return 'Duplicated: ' + clone.id;";
    assert.strictEqual(parseLikeFigmaUse(evalArg(code)), code);
  });

  it('does not flatten — the old behavior is what broke', () => {
    assert.doesNotMatch(evalArg('a\nb'), /^eval "a b"$/);
  });
});
