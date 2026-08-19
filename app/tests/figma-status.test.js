import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  cleanFileName,
  figmaButtonLabel,
  statusRows,
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

describe('figmaButtonLabel', () => {
  const on = { daemon: 'ok', figma: 'ok' };

  it('reads like Figma\'s breadcrumb when both names are known', () => {
    assert.strictEqual(
      figmaButtonLabel({ ...on, file: 'Designdone', page: 'Landingpage' }),
      'Designdone/Landingpage'
    );
  });

  it('shows the file alone while the page is unknown', () => {
    assert.strictEqual(figmaButtonLabel({ ...on, file: 'Designdone', page: '' }), 'Designdone');
  });

  it('falls back to a state, never to an empty button', () => {
    assert.strictEqual(figmaButtonLabel({ ...on, file: '', page: '' }), 'no file');
  });

  it('names the two failure states apart', () => {
    assert.strictEqual(
      figmaButtonLabel({ daemon: 'ok', figma: 'off', file: 'Designdone', page: 'Landingpage' }),
      'not connected'
    );
    assert.strictEqual(
      figmaButtonLabel({ daemon: 'off', figma: 'off', file: '', page: '' }),
      'offline'
    );
  });
});

describe('statusRows', () => {
  const rows = (probe) => Object.fromEntries(statusRows(probe).map((r) => [r.label, r]));

  it('reports a healthy Yolo connection', () => {
    const r = rows({
      figmaRunning: true,
      cdpOk: true,
      cdpPort: 9222,
      health: { mode: 'yolo', cdp: true }
    });
    assert.deepStrictEqual(r.Figma, { label: 'Figma', state: 'ok', value: 'running' });
    assert.deepStrictEqual(r.CDP, { label: 'CDP', state: 'ok', value: 'port 9222' });
    assert.deepStrictEqual(r.Daemon, { label: 'Daemon', state: 'ok', value: 'yolo' });
  });

  it('does not call a dead CDP port a fault in Safe Mode', () => {
    const r = rows({
      figmaRunning: true,
      cdpOk: false,
      cdpPort: 9222,
      health: { mode: 'plugin', plugin: true }
    });
    assert.strictEqual(r.CDP.state, 'warn');
    assert.strictEqual(r.CDP.value, 'unused (plugin)');
    assert.strictEqual(r.Daemon.state, 'ok');
  });

  it('separates a dead daemon from a daemon with no Figma behind it', () => {
    const dead = rows({ figmaRunning: false, cdpOk: false, cdpPort: 9222, health: null });
    assert.strictEqual(dead.Daemon.value, 'not running');
    assert.strictEqual(dead.Daemon.state, 'off');
    assert.strictEqual(dead.Figma.state, 'warn');

    const orphan = rows({
      figmaRunning: true,
      cdpOk: false,
      cdpPort: 9222,
      health: { mode: 'yolo', cdp: false, plugin: false }
    });
    assert.strictEqual(orphan.Daemon.state, 'warn');
    assert.strictEqual(orphan.Daemon.value, 'no connection to Figma');
  });
});
