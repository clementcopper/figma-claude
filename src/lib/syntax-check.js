/**
 * Does the submitted code parse at all — and if not, where does it break?
 *
 * A run script with a line cut in half came back from Figma as `SyntaxError: Invalid or
 * unexpected token` with no line (FEEDBACK.md, 2026-10-02); `node --check` found it at once.
 * The CLI runs on the same grammar as the page, so it can ask before sending. `vm.Script` is
 * used rather than `new Function` because V8 decorates its SyntaxError with the file name,
 * the line, the source line and a caret — exactly what `node --check` prints.
 *
 * The statement wrapper is the one whose error is reported: it is what the daemon would run
 * (src/lib/eval-wrap.js), and inside it a top-level `return` or `await` is legal, so the first
 * error V8 meets is the real one and not "Illegal return statement". Raw code is tried first so
 * an IIFE the user wrote keeps its own line numbers.
 *
 * Nothing here executes: `new vm.Script` only compiles.
 */
import vm from 'node:vm';

/**
 * @param {string} code
 * @param {string} filename what the error should name
 * @returns {null | { line: number, column: number, message: string, excerpt: string[] }}
 *   `excerpt` is the source line and the caret line, as V8 prints them
 */
export function syntaxError(code, filename = '<eval>') {
  const forms = [
    { src: code, lineOffset: 0 },
    { src: `(async () => (\n${code}\n))()`, lineOffset: -1 },
    { src: `(async () => {\n${code}\n})()`, lineOffset: -1 }
  ];
  let statementError = null;
  for (const form of forms) {
    try {
      // eslint-disable-next-line no-new
      new vm.Script(form.src, { filename, lineOffset: form.lineOffset });
      return null;
    } catch (e) {
      statementError = e;
    }
  }
  return describe(statementError, filename);
}

function describe(e, filename) {
  const message = e && e.message ? e.message : String(e);
  const lines = String(e && e.stack || '').split('\n');
  const head = lines[0] || '';
  const m = head.match(/:(\d+)$/);
  if (!m || !head.startsWith(filename)) {
    return { line: 0, column: 0, message, excerpt: [] };
  }
  const srcLine = lines[1] || '';
  const caret = lines[2] || '';
  const column = caret.indexOf('^') + 1;
  return { line: Number(m[1]), column: column > 0 ? column : 0, message, excerpt: [srcLine, caret] };
}
