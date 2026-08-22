/**
 * Showing what is in the config without showing what must not be shown.
 *
 * `config get`/`set` were the only way in, so listing required knowing the key you were looking
 * for — reported from the panel, where `config list` answered `error: unknown command 'list'`.
 *
 * The reason this is a separate, tested module rather than a `console.log` in the command: the
 * config holds API keys (`removebgApiKey`), and the rule for those is that their value never
 * reaches the output — not in a log, not truncated to "first ten characters", which is what
 * `config set` still prints today. A masked row states that a secret is set and how long it is;
 * anything more is a leak with extra steps.
 */

/** A key whose value is a credential rather than a setting. */
export function isSecretKey(key) {
  return /(key|token|secret|password|passwd|credential)/i.test(String(key || ''));
}

/**
 * One row per config entry: the key, and a value that is safe to print.
 *
 * @param {object} config parsed config file
 * @returns {{key: string, value: string, secret: boolean}[]} sorted by key
 */
export function configRows(config) {
  const source = config && typeof config === 'object' ? config : {};
  return Object.keys(source)
    .sort()
    .map((key) => {
      const raw = source[key];
      const secret = isSecretKey(key);
      if (secret) {
        const length = typeof raw === 'string' ? raw.length : String(raw ?? '').length;
        return { key, value: `set, ${length} characters`, secret: true };
      }
      if (raw === null || raw === undefined) return { key, value: '—', secret: false };
      if (typeof raw === 'object') return { key, value: JSON.stringify(raw), secret: false };
      return { key, value: String(raw), secret: false };
    });
}
