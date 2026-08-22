import { describe, it } from 'node:test';
import assert from 'node:assert';
import { configRows, isSecretKey } from '../src/lib/config-view.js';

describe('isSecretKey', () => {
  it('catches the credential spellings the config actually uses', () => {
    for (const key of ['removebgApiKey', 'apiKey', 'ANTHROPIC_API_KEY', 'daemonToken', 'secret', 'password']) {
      assert.ok(isSecretKey(key), key);
    }
  });

  it('leaves ordinary settings alone', () => {
    for (const key of ['patched', 'port', 'lastFile', 'mode']) {
      assert.ok(!isSecretKey(key), key);
    }
  });
});

describe('configRows', () => {
  it('never puts a secret value in the output', () => {
    const rows = configRows({ removebgApiKey: 'sk-live-abcdef0123456789' });
    assert.strictEqual(rows.length, 1);
    assert.ok(!rows[0].value.includes('sk-live'), rows[0].value);
    assert.ok(!rows[0].value.includes('abcdef'), rows[0].value);
    assert.match(rows[0].value, /^set, 24 characters$/);
    assert.strictEqual(rows[0].secret, true);
  });

  it('prints ordinary values as they are', () => {
    const rows = configRows({ patched: true, port: 9222 });
    assert.deepStrictEqual(
      rows.map((r) => [r.key, r.value]),
      [['patched', 'true'], ['port', '9222']]
    );
  });

  it('sorts by key, so two runs read the same', () => {
    const rows = configRows({ zeta: 1, alpha: 2, mid: 3 });
    assert.deepStrictEqual(rows.map((r) => r.key), ['alpha', 'mid', 'zeta']);
  });

  it('shows an empty or missing value as a dash', () => {
    const rows = configRows({ a: null, b: undefined });
    assert.deepStrictEqual(rows.map((r) => r.value), ['—', '—']);
  });

  it('serialises objects rather than printing [object Object]', () => {
    assert.strictEqual(configRows({ env: { A: '1' } })[0].value, '{"A":"1"}');
  });

  it('survives a missing or broken config', () => {
    assert.deepStrictEqual(configRows(undefined), []);
    assert.deepStrictEqual(configRows('nope'), []);
  });
});
