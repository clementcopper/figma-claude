import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { debugPortRow, figmaVersionRow } from '../src/lib/diagnose-rows.js';

// `diagnose` in Pipe Mode printed "✗ Remote debugging not available (port 9222 closed)" and
// "→ Run: connect" above "✓ Connected to …" — reported from the panel, whose rules forbid
// running connect. Pipe Mode has no port by design, like Safe Mode.

describe('debugPortRow', () => {
  it('a closed port is informational in Pipe Mode and names the pipe', () => {
    const row = debugPortRow('pipe', false, 9222);
    assert.equal(row.ok, true);
    assert.equal(row.level, 'info');
    assert.match(row.text, /Pipe Mode/);
    assert.equal(row.hint, null);
  });

  it('a closed port stays informational in Safe Mode', () => {
    const row = debugPortRow('safe', false, 9222);
    assert.equal(row.ok, true);
    assert.match(row.text, /Safe Mode/);
  });

  it('a closed port is the fault in Yolo Mode, with the connect hint', () => {
    for (const mode of ['yolo', 'auto', null, undefined]) {
      const row = debugPortRow(mode, false, 9222);
      assert.equal(row.ok, false, String(mode));
      assert.match(row.hint, /connect/);
    }
  });

  it('an open port is fine in every mode', () => {
    for (const mode of ['pipe', 'safe', 'yolo']) {
      assert.equal(debugPortRow(mode, true, 9333).text, 'Remote debugging enabled (port 9333)');
    }
  });
});

describe('figmaVersionRow', () => {
  it('warns about 126+ only where the port is the way in', () => {
    assert.equal(figmaVersionRow('126.7.10', 'yolo').level, 'warn');
    assert.equal(figmaVersionRow('126.7.10', 'pipe').level, 'ok');
    assert.equal(figmaVersionRow('126.7.10', 'safe').level, 'ok');
    assert.equal(figmaVersionRow('125.0.1', 'yolo').level, 'ok');
  });
});
