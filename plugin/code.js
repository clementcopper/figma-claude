/**
 * FigCli — the Safe Mode plugin
 *
 * Connects to the figma-cli daemon over a loopback WebSocket (ui.html) and runs the code
 * the CLI sends in this main thread. No debug port, no patching.
 *
 * Tested in Node by tests/plugin-executor.test.js, which loads this file with a stubbed
 * `figma` and drives `figma.ui.onmessage` the way ui.html does.
 */

// Show minimal UI (needed for WebSocket connection)
figma.showUI(__html__, {
  width: 200,
  height: 100,
  position: { x: -9999, y: 9999 }  // Bottom-left (push to far left)
});

// Figma's QuickJS sandbox blocks `new Function` / `new AsyncFunction`; eval() runs in the
// plugin's main scope where `figma` is already global. Evaluating a parenthesised function
// expression only PARSES the code — nothing runs until the function is called.
function compilesInSandbox(src) {
  try {
    eval(`(${src})`);
    return true;
  } catch {
    return false;
  }
}

// Same decision as src/lib/eval-wrap.js for the CDP path — keep them in step, the parity
// test compares both. Guessing with `lastIndexOf(';')` used to turn `let p = 1\nreturn p`,
// `if (x) { … }` and `const a = 1; const b = 2` into a SyntaxError in Safe Mode only.
// Returns the source of an async function to call, or null when nothing compiles.
function wrapForSandbox(code) {
  const trimmed = code.trim();
  // Already an IIFE — the caller wrapped it, run it as written.
  if (/^\(\s*(async\b|function\b|\(|[A-Za-z_$][\w$]*\s*=>)/.test(trimmed)) {
    return `async () => (\n${code}\n)`;
  }
  // A single expression: its VALUE is the result (a bare `figma.root.name`).
  const expression = `async () => (\n${code}\n)`;
  if (compilesInSandbox(expression)) return expression;
  // A statement list: `return` and `await` are legal inside.
  const statements = `async () => {\n${code}\n}`;
  if (compilesInSandbox(statements)) return statements;
  return null;
}

// Execute code with auto-return and timeout protection
// The daemon sends the budget with each request (one number, from the CLI); 90 s is the
// CLI's own default when a message carries none.
async function executeCode(code, timeoutMs = 90000) {
  timeoutMs = Number(timeoutMs) || 90000;

  // Malformed either way: run the statement form so the error names the real problem.
  const wrapped = wrapForSandbox(code) || `async () => {\n${code}\n}`;
  const fn = eval(`(${wrapped})`);

  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Execution timeout (${timeoutMs / 1000}s)`)), timeoutMs);
  });

  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    // Without this every finished eval left a live timer whose late rejection nobody handled.
    clearTimeout(timer);
  }
}

// `throw 'text'` and thrown objects have no .message; sent as-is they became a silent success
// (no error field on the wire, result undefined).
function errorText(error) {
  if (error && typeof error.message === 'string') return error.message;
  return String(error);
}

// Handle messages from UI (WebSocket bridge)
const TOKEN_KEY = 'daemonToken';

figma.ui.onmessage = async (msg) => {
  // The daemon session token lives in clientStorage; the UI iframe has no
  // storage of its own. Asked for on start, saved when the user pastes it.
  if (msg.type === 'get-token') {
    const token = await figma.clientStorage.getAsync(TOKEN_KEY);
    // The file name rides along: the UI puts it into its hello so the daemon can report it.
    figma.ui.postMessage({ type: 'token', token: token || null, file: figma.root.name });
  }
  if (msg.type === 'save-token') {
    await figma.clientStorage.setAsync(TOKEN_KEY, msg.token);
  }

  // Single eval
  if (msg.type === 'eval') {
    try {
      const result = await executeCode(msg.code, msg.timeoutMs);
      figma.ui.postMessage({ type: 'result', id: msg.id, result: result });
    } catch (error) {
      figma.ui.postMessage({ type: 'result', id: msg.id, error: errorText(error) });
    }
  }

  if (msg.type === 'connected') {
    figma.notify('✓ FigCli connected', { timeout: 2000 });
  }

  if (msg.type === 'disconnected') {
    figma.notify('FigCli disconnected', { timeout: 2000 });
  }

  if (msg.type === 'error') {
    figma.notify('FigCli: ' + msg.message, { error: true });
  }
};

console.log('FigCli plugin started');
