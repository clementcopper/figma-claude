/**
 * Find the root <Frame> of a JSX string.
 *
 * The parser used /<Frame\s+([^>]*)>/ — unanchored and with mandatory attributes. So
 * `<Frame>\n<Frame name="inner">…` took the INNER frame as root (the wrapper and every
 * sibling silently dropped), and a plain `<Frame>` was refused as "must start with <Frame>".
 * Anchored at the start, attributes optional, one place for the three callers.
 */
const ROOT = /^\s*<Frame(?:\s+([^>]*?))?\s*>/;

/** @returns {{ propsStr: string, end: number } | null} — `end` is the index just past the opening tag. */
export function matchRootFrame(jsx) {
  const m = String(jsx).match(ROOT);
  return m ? { propsStr: (m[1] || '').trim(), end: m[0].length } : null;
}
