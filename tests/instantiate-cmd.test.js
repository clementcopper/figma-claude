import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instantiateCode } from '../src/commands/instantiate.js';

test('instantiateCode is syntactically valid JS for a key+id plan', () => {
  const code = instantiateCode([{ via: 'key', key: 'k' }, { via: 'id', id: '1:2' }]);
  assert.doesNotThrow(() => new Function(`return ${code}`));
  assert.match(code, /importComponentByKeyAsync/);
  assert.match(code, /getNodeByIdAsync/);
  assert.match(code, /createInstance/);
  // dynamic-page safe: no legacy sync getNodeById( in the generated code
  assert.doesNotMatch(code, /[^A-Za-z]getNodeById\(/);
});

test('instantiateCode places a row when --count is given', () => {
  const code = instantiateCode([{ via: 'id', id: '1:2' }], { count: 20, gap: 8 });
  assert.doesNotThrow(() => new Function(code), 'still valid JS');
  assert.match(code, /const count = 20;/);
  assert.match(code, /const gap = 8;/);
  assert.match(code, /i \* \(inst\.width \+ gap\)/, 'a row, not a pile');
});

test('instantiateCode defaults to one instance', () => {
  const code = instantiateCode([{ via: 'id', id: '1:2' }]);
  assert.match(code, /const count = 1;/);
  assert.match(code, /const gap = 24;/);
});

test('instantiateCode clamps a nonsense count instead of generating it', () => {
  assert.match(instantiateCode([], { count: 'abc' }), /const count = 1;/);
  assert.match(instantiateCode([], { count: -5 }), /const count = 1;/);
  assert.match(instantiateCode([], { count: 9999 }), /const count = 200;/);
});

test('an id route loads other pages and resolves an instance to its component', () => {
  // Both were dead ends for the panel session: the id was on an unloaded page, and the only
  // reachable handle was an instance rather than the component.
  const code = instantiateCode([{ via: 'id', id: '1:2' }]);
  assert.match(code, /loadAllPagesAsync\(\)/);
  assert.match(code, /getMainComponentAsync\(\)/);
});

test('--parent appends there instead of the current page, and the row starts at the container', () => {
  // Seven instances landed on the page the user had last clicked, three times in one day
  // (FEEDBACK.md, 16 Sep 2026). Coordinates inside a container are the container's, so the row
  // starts at its origin — only the current page keeps the viewport centre it used to use.
  const code = instantiateCode([{ via: 'id', id: '1:2' }], { parent: '9:9', count: 3 });
  assert.doesNotThrow(() => new Function(`return ${code}`));
  assert.match(code, /__p\.appendChild\(inst\)/);
  assert.doesNotMatch(code, /figma\.currentPage\.appendChild/);
  assert.match(code, /__p === figma\.currentPage\) \? figma\.viewport\.center/);
  // In an auto-layout parent the layout places the children; x/y are not ours to set.
  assert.match(code, /const flow = !!\(__p\.layoutMode && __p\.layoutMode !== 'NONE'\)/);
  assert.match(code, /if \(!flow\) \{/);
});

test('without --parent nothing about the old placement changes', () => {
  const code = instantiateCode([{ via: 'id', id: '1:2' }], { count: 2 });
  assert.match(code, /figma\.currentPage\.appendChild\(inst\)/);
  assert.match(code, /const flow = false/);
  // No parent resolution at all — `__page` is a different variable and stays.
  assert.doesNotMatch(code, /__p\.appendChild/);
  assert.doesNotMatch(code, /Parent not found/);
});

test('the answer names the page, and a node on another page is never selected', () => {
  for (const opts of [{}, { parent: '9:9' }]) {
    const code = instantiateCode([{ via: 'id', id: '1:2' }], opts);
    assert.match(code, /page: __page \? __page\.name : null/);
    // figma.currentPage.selection only accepts nodes of the current page — it throws otherwise.
    assert.match(code, /if \(__page === figma\.currentPage\) \{/);
  }
});
