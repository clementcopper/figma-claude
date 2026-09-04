/**
 * Figma CLI Bridge Plugin
 *
 * Safe Mode: Connects to CLI daemon via WebSocket
 * No debug port needed, no patching required.
 */

// Show minimal UI (needed for WebSocket connection)
figma.showUI(__html__, {
  width: 200,
  height: 100,
  position: { x: -9999, y: 9999 }  // Bottom-left (push to far left)
});

// Execute code with auto-return and timeout protection
// The daemon sends the budget with each request (one number, from the CLI); 90 s is the
// CLI's own default when a message carries none.
async function executeCode(code, timeoutMs = 90000) {
  timeoutMs = Number(timeoutMs) || 90000;
  let trimmed = code.trim();

  // Don't add return if code already starts with return
  if (!trimmed.startsWith('return ')) {
    const isSimpleExpr = !trimmed.includes(';');
    const isIIFE = trimmed.startsWith('(function') || trimmed.startsWith('(async function');
    const isArrowIIFE = trimmed.startsWith('(() =>') || trimmed.startsWith('(async () =>');

    if (isSimpleExpr || isIIFE || isArrowIIFE) {
      trimmed = `return ${trimmed}`;
    } else {
      const lastSemicolon = trimmed.lastIndexOf(';');
      if (lastSemicolon !== -1) {
        const beforeLast = trimmed.substring(0, lastSemicolon + 1);
        const lastStmt = trimmed.substring(lastSemicolon + 1).trim();
        if (lastStmt && !lastStmt.startsWith('return ')) {
          trimmed = beforeLast + ' return ' + lastStmt;
        }
      }
    }
  }

  // Figma's QuickJS sandbox blocks `new Function` / `new AsyncFunction`.
  // eval() runs in the plugin's main scope where `figma` is already global.
  const execPromise = eval(`(async () => { ${trimmed} })()`);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Execution timeout (${timeoutMs/1000}s)`)), timeoutMs)
  );

  return Promise.race([execPromise, timeoutPromise]);
}

// Handle messages from UI (WebSocket bridge)
const TOKEN_KEY = 'daemonToken';

figma.ui.onmessage = async (msg) => {
  // The daemon session token lives in clientStorage; the UI iframe has no
  // storage of its own. Asked for on start, saved when the user pastes it.
  if (msg.type === 'get-token') {
    const token = await figma.clientStorage.getAsync(TOKEN_KEY);
    figma.ui.postMessage({ type: 'token', token: token || null });
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
      figma.ui.postMessage({ type: 'result', id: msg.id, error: error.message });
    }
  }

  // Batch eval (execute multiple codes in sequence, return all results)
  if (msg.type === 'eval-batch') {
    const results = [];
    for (const code of msg.codes) {
      try {
        const result = await executeCode(code, msg.timeoutMs);
        results.push({ success: true, result });
      } catch (error) {
        results.push({ success: false, error: error.message });
      }
    }
    figma.ui.postMessage({ type: 'batch-result', id: msg.id, results: results });
  }

  if (msg.type === 'connected') {
    figma.notify('✓ Figma DS CLI connected', { timeout: 2000 });
  }

  if (msg.type === 'disconnected') {
    figma.notify('Figma DS CLI disconnected', { timeout: 2000 });
  }

  if (msg.type === 'error') {
    figma.notify('Figma DS CLI: ' + msg.message, { error: true });
  }
};

// Keep plugin alive
figma.on('close', () => {
  // Plugin closed
});

console.log('Figma DS CLI plugin started');
