import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  cleanFileName,
  toStatusView,
  describeSelection,
  selectionPromptText
} from '../dist/lib/figma-status.mjs';

describe('toStatusView', () => {
  it('reports both halves down when the daemon is unreachable', () => {
    const view = toStatusView(null);
    assert.strictEqual(view.daemon, 'off');
    assert.strictEqual(view.figma, 'off');
    assert.match(view.tooltip, /connect/);
  });

  // The state that otherwise looks like "commands silently do nothing": daemon up, Figma gone.
  it('separates a running daemon from a live Figma', () => {
    const view = toStatusView({ status: 'disconnected', mode: 'cdp', cdp: false, plugin: false });
    assert.strictEqual(view.daemon, 'ok');
    assert.strictEqual(view.figma, 'off');
  });

  it('counts the plugin transport as connected (Safe Mode)', () => {
    const view = toStatusView({ mode: 'plugin', cdp: false, plugin: true, file: 'Designdone' });
    assert.strictEqual(view.figma, 'ok');
    assert.strictEqual(view.file, 'Designdone');
    assert.match(view.tooltip, /Designdone/);
  });

  it('survives a health payload without a file', () => {
    const view = toStatusView({ mode: 'cdp', cdp: true, file: null });
    assert.strictEqual(view.file, '');
    assert.strictEqual(view.figma, 'ok');
  });
});

describe('cleanFileName', () => {
  it('drops the " – Figma" the browser title carries', () => {
    assert.strictEqual(cleanFileName('Designdone – Figma'), 'Designdone');
    assert.strictEqual(cleanFileName('Designdone - Figma'), 'Designdone');
  });

  it('leaves a plain name alone, including one that ends in Figma', () => {
    assert.strictEqual(cleanFileName('Designdone'), 'Designdone');
    assert.strictEqual(cleanFileName('My Figma'), 'My Figma');
  });

  it('handles null', () => {
    assert.strictEqual(cleanFileName(null), '');
  });
});

describe('describeSelection', () => {
  const node = (id, name, type = 'FRAME') => ({ id, name, type });

  it('names the page when nothing is selected', () => {
    assert.strictEqual(describeSelection([], 'Landingpage'), 'Landingpage — nothing selected');
  });

  it('uses the bare name for a single node', () => {
    assert.strictEqual(describeSelection([node('1:2', 'Hero')], 'Page'), 'Hero');
  });

  it('counts and lists several', () => {
    const text = describeSelection([node('1:2', 'Hero'), node('1:3', 'Button')], 'Page');
    assert.strictEqual(text, '2 selected: Hero, Button');
  });
});

describe('selectionPromptText', () => {
  it('is null when nothing is selected — there is nothing to insert', () => {
    assert.strictEqual(selectionPromptText([]), null);
  });

  // Ids are the point: they are what `figma-cli get`, `set` and `render --parent` take.
  it('carries name, type and id', () => {
    const text = selectionPromptText([{ id: '298:4001', name: 'Hero', type: 'FRAME' }]);
    assert.strictEqual(text, 'Figma selection: "Hero" (FRAME 298:4001)');
  });

  it('joins several selections', () => {
    const text = selectionPromptText([
      { id: '1:2', name: 'A', type: 'FRAME' },
      { id: '1:3', name: 'B', type: 'TEXT' }
    ]);
    assert.strictEqual(text, 'Figma selection: "A" (FRAME 1:2), "B" (TEXT 1:3)');
  });
});
