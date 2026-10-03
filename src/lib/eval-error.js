/**
 * Putting the file's own line numbers on a stack that came back from Figma.
 *
 * A script that throws inside `run` used to print only the message (FEEDBACK.md, 18 Sep 2026:
 * a `TypeError: Cannot convert a Symbol value to a string` took three extra runs to locate in
 * a 200-line script). The daemon had the stack all along; every frame reads `<anonymous>:L:C`
 * because the code is evaluated without a sourceURL, and L is off by the one line the wrapper
 * in src/lib/eval-wrap.js puts above the user's code.
 */
import { wrapCodeIfNeeded } from './eval-wrap.js';

const FRAME = /<anonymous>:(\d+):(\d+)/g;

/**
 * How many lines sit above the user's first line in what Figma evaluates. The daemon asks the
 * same function, so the two ends cannot disagree: an IIFE (or code that does not compile at
 * all) is sent as written, everything else gets one wrapper line.
 */
export function lineOffsetFor(code) {
  return wrapCodeIfNeeded(code) === code ? 0 : 1;
}

/**
 * @param {string[]} lines frames as V8 printed them (`    at f (<anonymous>:4:17)`)
 * @param {{ file: string, lineOffset: number, lineCount: number }} opts
 * @returns {string[]} the same lines against `file`; frames outside the file (the wrapper's
 *   own lines) are dropped, lines that are not frames pass through
 */
export function relocateFrames(lines, { file, lineOffset, lineCount }) {
  const out = [];
  for (const line of lines) {
    if (!FRAME.test(line)) { out.push(line); FRAME.lastIndex = 0; continue; }
    FRAME.lastIndex = 0;
    let inside = true;
    const mapped = line.replace(FRAME, (_, l, c) => {
      const n = Number(l) - lineOffset;
      if (n < 1 || n > lineCount) inside = false;
      return `${file}:${n}:${c}`;
    });
    if (inside) out.push(mapped);
  }
  return out;
}
