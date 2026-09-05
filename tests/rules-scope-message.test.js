import { describe, it } from 'node:test';
import assert from 'node:assert';
import { noComponentSetsMessage } from '../src/commands/rules.js';

// `rules gen --pages "CLI Lab"` said "No component sets found in this file" while the file had
// several on another page; the scope was empty, not the file.

describe('noComponentSetsMessage', () => {
  it('names the file without a scope', () => {
    assert.strictEqual(noComponentSetsMessage({}), 'No component sets found in this file.');
  });
  it('names the page filter', () => {
    assert.match(noComponentSetsMessage({ pages: 'CLI Lab' }), /in the selected scope \(pages matching "CLI Lab"\)/);
  });
  it('names the selection', () => {
    assert.match(noComponentSetsMessage({ selection: true }), /in the selection/);
  });
  it('names the --only filter first', () => {
    assert.match(noComponentSetsMessage({ only: 'Btn', pages: 'x' }), /No component set matches "Btn"/);
  });
});
