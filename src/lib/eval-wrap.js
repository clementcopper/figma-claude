/**
 * Wrapping user code so CDP's Runtime.evaluate can run it.
 *
 * Lives in its own module so it can be unit-tested: importing daemon.js
 * starts an HTTP server and a CDP connection.
 */

/** Does `src` compile? Syntax only — nothing is executed. */
function compiles(src) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(src);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wrap user code so CDP's Runtime.evaluate can run it.
 *
 * A bare `return` is illegal at script top level, and so is a bare `await`, so
 * both need an async IIFE around them. This used to guess with three regexes
 * that looked for `return`, which missed two common shapes and produced a raw
 * SyntaxError from inside Figma:
 *
 *   figma.getNodeByIdAsync(id)  with a top-level await   -> "await is only valid
 *                                                           in async functions"
 *   let p = 1\nreturn p         (no `;` before return)   -> "Illegal return"
 *   if (!p) { return 'x' }      (return not after a `;`) -> "Illegal return"
 *
 * Guessing is unnecessary: the daemon runs on the same JS grammar as the page,
 * so we can just ASK the engine which wrapper compiles. `new Function` only
 * parses — nothing here executes user code.
 *
 * Expression form is preferred when it compiles, because that is what makes a
 * bare `figma.root.name` evaluate to the name instead of to undefined.
 */
export function wrapCodeIfNeeded(code) {
  const trimmed = code.trim();
  if (!trimmed) return code;

  // Already an IIFE — the caller wrapped it, leave it exactly as written.
  if (/^\(\s*(async\b|function\b|\(|[A-Za-z_$][\w$]*\s*=>)/.test(trimmed)) {
    return code;
  }

  // Both probes compile the FINAL wrapper, so `await` is tested inside the
  // async context it will actually run in.

  // A single expression: wrap so its VALUE is returned. This is what makes a
  // bare `figma.root.name` — or a bare `await getNodeByIdAsync(id)` — evaluate
  // to the thing itself rather than to undefined.
  if (compiles(`return (async () => (\n${code}\n))();`)) {
    return `(async () => (\n${code}\n))()`;
  }

  // Otherwise a statement list: `return` and `await` are both legal inside.
  if (compiles(`return (async () => {\n${code}\n})();`)) {
    return `(async () => {\n${code}\n})()`;
  }

  // Genuinely malformed — hand it through so Figma reports the real syntax
  // error against the code the user actually wrote.
  return code;
}
