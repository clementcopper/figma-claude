/**
 * Hex colour parsing that answers null instead of throwing.
 *
 * `hexToRgb` in cli-core throws on a bad value, and `set fill zzz` destructured its result
 * with nothing to catch it: a Node stack trace where one line naming the value was due.
 * Commands ask here first; the throwing helper stays for callers that already handle it.
 */
export function parseHexColor(value) {
  if (typeof value !== 'string') return null;
  let hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split('').map((c) => c + c).join('');
  const m = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(hex);
  if (!m) return null;
  const c = { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
  if (m[4] !== undefined) c.a = parseInt(m[4], 16) / 255;
  return c;
}

/** One-line message for a rejected colour argument. */
export function invalidColorMessage(value) {
  return `Invalid color "${value}" — use #rrggbb (or var:name for a variable)`;
}
