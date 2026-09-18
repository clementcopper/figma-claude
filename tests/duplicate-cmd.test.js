import { describe, it } from 'node:test';
import assert from 'node:assert';
import { duplicateByIdCode } from '../src/commands/canvas-ops.js';

// Reported from the panel (FEEDBACK.md): `duplicate "I16451:71866;2029:67533;2151:87636"` answered
// "Node not found". Nested ids do resolve — measured against a live file — but only on pages that
// are loaded, and the id came from another page.

describe('duplicateByIdCode', () => {
  it('tries the loaded pages first and only then loads the rest', () => {
    // `loadAllPagesAsync()` up front blew the 60 s sync eval budget on a file with 5235
    // instances: `spawnSync /bin/sh ETIMEDOUT`, no duplicate.
    const code = duplicateByIdCode('1:2', '20');
    assert.match(code, /loadAllPagesAsync\(\)/);
    assert.ok(
      code.indexOf('getNodeByIdAsync') < code.indexOf('loadAllPagesAsync'),
      'the cheap lookup has to come first'
    );
    assert.strictEqual(code.split('getNodeByIdAsync').length - 1, 2, 'looked up again after loading');
  });

  it('says what it searched when nothing was found', () => {
    // The bare "Node not found" reads like a typo; the id may simply live in another file.
    assert.match(duplicateByIdCode('1:2', '20'), /searched every page/);
  });

  it('passes the id through as a JSON string, nested form included', () => {
    const code = duplicateByIdCode('I16451:71866;2029:67533;2151:87636', '0');
    assert.match(code, /"I16451:71866;2029:67533;2151:87636"/);
  });

  it('walks up to the outermost instance, not the first one', () => {
    const code = duplicateByIdCode('1:2', '20');
    assert.match(code, /while \(p\) \{ if \(p\.type === 'INSTANCE'\) outer = p; p = p\.parent; \}/);
  });

  it('re-parents the clone next to that instance', () => {
    const code = duplicateByIdCode('1:2', '20');
    assert.match(code, /outer\.parent\.appendChild\(clone\)/);
    assert.match(code, /clone\.x = outer\.x \+ 20/);
  });

  it('keeps the plain offset for a node that is not inside an instance', () => {
    assert.match(duplicateByIdCode('1:2', '35'), /clone\.x \+= 35/);
  });

  it('accepts an offset of 0 rather than falling back to the default', () => {
    // `--offset 0` is what the reporter used; a truthiness check would have made it 20.
    const code = duplicateByIdCode('1:2', '0');
    assert.match(code, /clone\.x \+= 0/);
    assert.doesNotMatch(code, /clone\.x \+= 20/);
  });

  it('refuses a non-numeric offset instead of generating a ReferenceError', () => {
    // The value is interpolated into source text, so `--offset abc` used to become `x += abc`.
    const code = duplicateByIdCode('1:2', 'abc');
    assert.match(code, /clone\.x \+= 20/);
    assert.doesNotMatch(code, /abc/);
  });
});

describe('duplicateByIdCode with --parent', () => {
  it('puts the copy where the caller said, and leaves the instance rule to the other path', () => {
    const code = duplicateByIdCode('1:2', 20, { parent: '9:9' });
    assert.doesNotThrow(() => new Function(`return ${code}`));
    assert.match(code, /__p\.appendChild\(clone\)/);
    assert.doesNotMatch(code, /outer\.parent\.appendChild\(clone\)/);
    // An auto-layout parent places its children; the offset would fight it.
    assert.match(code, /if \(!\(__p\.layoutMode && __p\.layoutMode !== 'NONE'\)\) \{ clone\.x \+= 20/);
    // The parent is resolved before the clone exists, so a wrong id leaves nothing behind.
    assert.ok(code.indexOf('Parent not found') < code.indexOf('node.clone()'));
  });

  it('names the page it landed on', () => {
    for (const opts of [undefined, { parent: '9:9' }]) {
      assert.match(duplicateByIdCode('1:2', 20, opts), /on page "' \+ __page\.name \+ '"/);
    }
  });
});
