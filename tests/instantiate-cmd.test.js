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
