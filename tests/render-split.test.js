import { describe, it } from 'node:test';
import assert from 'node:assert';
import { autoSplitArgs } from '../src/lib/render-split.js';

// The auto-split re-entered `render-batch` with three of render's flags and dropped the rest:
// `render … --verify` printed "outer flex wrapper detected" and then no verification, with
// no word that the flag was ignored. `--parent`, `-x`, `-y` have no batch equivalent at all.

const split = { direction: 'row', children: ['<Frame name="a"/>', '<Frame name="b"/>'] };

describe('autoSplitArgs', () => {
  it('forwards every flag render-batch understands', () => {
    const r = autoSplitArgs({ asComponent: true, collection: 'Brand', verify: '3', autoStyle: false }, split);
    assert.ok(r.args);
    assert.deepStrictEqual(r.args.slice(0, 2), ['render-batch', JSON.stringify(split.children)]);
    for (const flag of ['--direction', 'row', '--as-component', '--collection', 'Brand', '--verify', '3', '--no-auto-style']) {
      assert.ok(r.args.includes(flag), `missing ${flag}`);
    }
  });

  it('passes --verify without a scale as a bare flag', () => {
    const r = autoSplitArgs({ verify: true }, split);
    const i = r.args.indexOf('--verify');
    assert.ok(i > 0 && (r.args[i + 1] === undefined || r.args[i + 1].startsWith('--')));
  });

  it('keeps the wrapper when a flag has no batch equivalent, and says which', () => {
    for (const [opts, flag] of [[{ parent: '1:2' }, '--parent'], [{ x: '10' }, '-x'], [{ y: '10' }, '-y'], [{ smartPosition: false }, '--no-smart-position']]) {
      const r = autoSplitArgs(opts, split);
      assert.strictEqual(r.args, undefined);
      assert.match(r.keepWrapper, new RegExp(flag.replace(/-/g, '\\-')));
    }
  });
});
