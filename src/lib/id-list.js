/**
 * One parser for node-id lists.
 *
 * Commands took ids in five formats — variadic args, comma-only, comma-or-JSON,
 * comma-or-space, and a JSON array — and a caller had to know which. Now every list-taking
 * command accepts any of them, in any mix: `a,b`, `a b`, one id per line, `["a","b"]`, or
 * several argv entries that may themselves carry lists. Duplicates are dropped, order kept.
 */
export const ID_LIST_HELP = 'ids separated by commas or spaces (a JSON array works too)';

export function parseIdList(input) {
  if (input === undefined || input === null) return [];
  const parts = Array.isArray(input) ? input : [input];
  const out = [];
  for (const part of parts) {
    const s = String(part).trim();
    if (!s) continue;
    let items = null;
    if (s.startsWith('[')) {
      try { const arr = JSON.parse(s); if (Array.isArray(arr)) items = arr.map(String); } catch {}
    }
    if (!items) items = s.split(/[\s,]+/);
    for (const id of items) {
      const t = id.trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}
