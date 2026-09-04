// Commands: export-eval (extracted from index.js)
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  program,
  checkConnection,
  checkConnectionSync,
  daemonExec,
  figmaEvalSync,
  figmaUse,
  isDaemonRunning,
  unescapeShell
} from '../lib/cli-core.js';
import { evalArg } from '../lib/eval-arg.js';
import { exportScaleSnippet } from '../lib/verify-export.js';
import { formatEvalOutput } from '../lib/eval-output.js';
import { explainEvalError, inPanel } from '../lib/connection-help.js';

// ============ EXPORT ============

const exp = program
  .command('export')
  .description('Export from Figma');

exp
  .command('screenshot')
  .description('Take a screenshot of selected node or current page')
  .option('-o, --output <file>', 'Output file', 'screenshot.png')
  .option('-s, --scale <number>', 'Export scale (1-4)', '2')
  .option('-f, --format <format>', 'Format: png, jpg, svg, pdf', 'png')
  .action((options) => {
    checkConnectionSync();
    const format = options.format.toUpperCase();
    const scale = parseFloat(options.scale);
    const code = `(async () => {
const sel = figma.currentPage.selection;
const node = sel.length > 0 ? sel[0] : figma.currentPage;
if (!node) return { error: 'No page or selection' };
if (!('exportAsync' in node)) return { error: 'Node cannot be exported' };
const bytes = await node.exportAsync({ format: ${JSON.stringify(format)}, constraint: { type: 'SCALE', value: ${scale} } });
return {
  name: node.name,
  id: node.id,
  width: Math.round(node.width * ${scale}),
  height: Math.round(node.height * ${scale}),
  bytes: Array.from(bytes)
};
})()`;
    const result = figmaEvalSync(code);
    if (result.error) {
      console.error(chalk.red('✗'), result.error);
      process.exit(1);
    }
    const buffer = Buffer.from(result.bytes);
    const outputFile = options.output === 'screenshot.png' && format !== 'PNG'
      ? `screenshot.${format.toLowerCase()}`
      : options.output;
    writeFileSync(outputFile, buffer);
    console.log(chalk.green('✓'), `Screenshot: ${result.name} (${result.width}x${result.height}) → ${outputFile}`);
  });

exp
  .command('node <nodeId>')
  .description('Export a node by ID as PNG')
  .option('-o, --output <file>', 'Output file', 'node-export.png')
  .option('-s, --scale <number>', 'Export scale', '2')
  .option('-f, --format <format>', 'Format: png, svg, pdf, jpg', 'png')
  .action((nodeId, options) => {
    checkConnectionSync();
    const format = options.format.toUpperCase();
    const scale = parseFloat(options.scale);
    const code = `(async () => {
const node = await figma.getNodeByIdAsync(${JSON.stringify(nodeId)});
if (!node) return { error: ${JSON.stringify(`Node not found: ${nodeId}`)} };
if (!('exportAsync' in node)) return { error: 'Node cannot be exported' };
const bytes = await node.exportAsync({ format: ${JSON.stringify(format)}, constraint: { type: 'SCALE', value: ${scale} } });
return {
  name: node.name,
  id: node.id,
  width: node.width,
  height: node.height,
  bytes: Array.from(bytes)
};
})()`;
    const result = figmaEvalSync(code);
    if (result.error) {
      console.error(chalk.red('✗'), result.error);
      process.exit(1);
    }
    const buffer = Buffer.from(result.bytes);
    const outputFile = options.output === 'node-export.png' && format !== 'PNG'
      ? `node-export.${format.toLowerCase()}`
      : options.output;
    writeFileSync(outputFile, buffer);
    console.log(chalk.green('✓'), `Exported ${result.name} (${result.width}x${result.height}) to ${outputFile}`);
  });

exp
  .command('css')
  .description('Export variables as CSS custom properties')
  .action(() => {
    checkConnectionSync();
    const code = `(async () => {
const vars = await figma.variables.getLocalVariablesAsync();
const css = vars.map(v => {
  const val = Object.values(v.valuesByMode)[0];
  if (v.resolvedType === 'COLOR') {
    const hex = '#' + [val.r, val.g, val.b].map(n => Math.round(n*255).toString(16).padStart(2,'0')).join('');
    return '  --' + v.name.replace(/\\//g, '-') + ': ' + hex + ';';
  }
  return '  --' + v.name.replace(/\\//g, '-') + ': ' + val + (v.resolvedType === 'FLOAT' ? 'px' : '') + ';';
}).join('\\n');
return ':root {\\n' + css + '\\n}';
})()`;
    const result = figmaUse(evalArg(code), { silent: true });
    console.log(result);
  });

exp
  .command('tailwind')
  .description('Export color variables as Tailwind config')
  .action(() => {
    checkConnectionSync();
    const code = `(async () => {
const vars = await figma.variables.getLocalVariablesAsync();
const colorVars = vars.filter(v => v.resolvedType === 'COLOR');
const colors = {};
colorVars.forEach(v => {
  const val = Object.values(v.valuesByMode)[0];
  const hex = '#' + [val.r, val.g, val.b].map(n => Math.round(n*255).toString(16).padStart(2,'0')).join('');
  const parts = v.name.split('/');
  if (parts.length === 2) {
    if (!colors[parts[0]]) colors[parts[0]] = {};
    colors[parts[0]][parts[1]] = hex;
  } else {
    colors[v.name.replace(/\\//g, '-')] = hex;
  }
});
return JSON.stringify({ theme: { extend: { colors } } }, null, 2);
})()`;
    const result = figmaUse(evalArg(code), { silent: true });
    console.log(result);
  });

exp
  .command('dtcg [output]')
  .description('Export variables as W3C Design Tokens (DTCG) JSON — the export side of token sync (import side: figma-cli import tokens.json)')
  .action((output) => {
    checkConnectionSync();
    const code = `(async () => {
const vars = await figma.variables.getLocalVariablesAsync();
const byId = {};
for (const v of vars) byId[v.id] = v.name;
const dot = n => n.replace(/\\//g, '.');
const h2 = n => Math.round(n*255).toString(16).padStart(2,'0');
const toColor = c => { const b = '#'+h2(c.r)+h2(c.g)+h2(c.b); return (c.a != null && c.a < 1) ? b+h2(c.a) : b; };
const tree = {};
const setPath = (path, token) => { const p = path.split('/'); let cur = tree; for (let i=0;i<p.length-1;i++){ if (!cur[p[i]] || cur[p[i]].$value !== undefined) cur[p[i]] = {}; cur = cur[p[i]]; } cur[p[p.length-1]] = token; };
for (const v of vars) {
  const val = Object.values(v.valuesByMode)[0];
  const dtype = v.resolvedType === 'COLOR' ? 'color' : v.resolvedType === 'FLOAT' ? 'dimension' : v.resolvedType === 'BOOLEAN' ? 'boolean' : 'string';
  let token;
  if (val && val.type === 'VARIABLE_ALIAS') {
    const ref = byId[val.id];
    token = { $type: dtype, $value: ref ? '{'+dot(ref)+'}' : null };
  } else if (v.resolvedType === 'COLOR') {
    token = { $type: 'color', $value: toColor(val) };
  } else if (v.resolvedType === 'FLOAT') {
    token = { $type: 'dimension', $value: val + 'px' };
  } else if (v.resolvedType === 'BOOLEAN') {
    token = { $type: 'boolean', $value: val };
  } else {
    token = { $type: 'string', $value: String(val) };
  }
  if (v.description) token.$description = v.description;
  setPath(v.name, token);
}
return JSON.stringify(tree, null, 2);
})()`;
    const result = figmaUse(evalArg(code), { silent: true });
    if (output) {
      writeFileSync(output, result.endsWith('\n') ? result : result + '\n');
      console.log(chalk.green('✓ Wrote DTCG tokens →'), output);
    } else {
      console.log(result);
    }
  });

// ============ VERIFY (AI Screenshot Check) ============

program
  .command('verify [nodeId]')
  .description('Take a small screenshot for AI verification (saves PNG to disk by default; --base64 to dump inline)')
  .option('-s, --scale <number>', 'Export scale (default: 0.5 for small size)', '0.5')
  .option('--max <pixels>', 'Max dimension in pixels (default: 2000)', '2000')
  .option('--save [path]', 'Custom PNG path (default: /tmp/figma-verify-{id}.png — save is the DEFAULT)')
  .option('--base64', 'Dump the base64 PNG to stdout instead of saving (token-heavy — opt-in only)')
  .option('--measure', 'Also return real (unscaled) node + child dimensions so size bugs are caught by measurement, not just the screenshot')
  .action((nodeId, options) => {
    checkConnectionSync();
    const scale = parseFloat(options.scale);
    const maxDim = parseInt(options.max);
    const withMeasure = !!options.measure;

    const code = `(async () => {
      let node;
      ${nodeId ? `node = await figma.getNodeByIdAsync(${JSON.stringify(nodeId)});` : `
      const sel = figma.currentPage.selection;
      node = sel.length > 0 ? sel[0] : null;
      `}
      if (!node) return { error: 'No node selected or found' };
      if (!('exportAsync' in node)) return { error: 'Node cannot be exported' };

      // How large the export comes out is decided in src/lib/verify-export.js, so this and
      // render --verify cannot drift apart again -- they already had.
      const nodeWidth = node.width || 100;
      const nodeHeight = node.height || 100;
      const chosen = ${exportScaleSnippet(scale, maxDim)};
      const finalScale = chosen.scale;

      const bytes = await node.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: finalScale }
      });

      // Convert to base64
      const base64 = figma.base64Encode(bytes);

      // Optional measurement tree: real (unscaled) dimensions of the node and
      // its children, so size regressions ("too tall") are caught by numbers.
      let measure = null;
      if (${withMeasure}) {
        const walk = (n, depth) => {
          const m = {
            name: n.name, type: n.type,
            w: Math.round(n.width), h: Math.round(n.height),
            layout: n.layoutMode && n.layoutMode !== 'NONE' ? n.layoutMode : undefined,
            sizeH: n.layoutSizingHorizontal, sizeV: n.layoutSizingVertical
          };
          if (depth > 0 && 'children' in n && n.children.length) {
            m.children = n.children.slice(0, 24).map(c => walk(c, depth - 1));
          }
          return m;
        };
        measure = walk(node, 3);
      }

      return {
        name: node.name,
        id: node.id,
        width: Math.round(nodeWidth * finalScale),
        height: Math.round(nodeHeight * finalScale),
        scale: finalScale,
        base64: base64,
        measure: measure
      };
    })()`;

    const result = figmaEvalSync(code);
    if (result.error) {
      console.error(chalk.red('✗'), result.error);
      process.exit(1);
    }

    // Default: save the PNG to disk and return only metadata (lean on tokens).
    // Dumping the raw base64 into stdout is now opt-in via --base64, because it
    // lands in the agent's context as raw text (tens of thousands of tokens for
    // a full frame). Reading the saved PNG back instead enters it as a real image.
    if (options.base64) {
      console.log(JSON.stringify({
        name: result.name,
        id: result.id,
        width: result.width,
        height: result.height,
        base64: result.base64,
        ...(result.measure ? { measure: result.measure } : {})
      }));
    } else {
      const safeId = result.id.replace(/:/g, '-');
      const savePath = typeof options.save === 'string'
        ? options.save
        : `/tmp/figma-verify-${safeId}.png`;

      const buffer = Buffer.from(result.base64, 'base64');
      writeFileSync(savePath, buffer);

      console.log(JSON.stringify({
        name: result.name,
        id: result.id,
        width: result.width,
        height: result.height,
        saved: savePath,
        ...(result.measure ? { measure: result.measure } : {})
      }));
    }
  });

// ============ EVAL ============

// ---- shared by `eval` and `run` ----
// They had two copies of the same three decisions and drifted apart: `run` never learned to
// name an empty result, and printed the bare word `null` for one. One home now.

/** A walk over every page can outlast the default; the ceiling is the caller's to raise. */
function evalTimeoutMs(raw) {
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 90000;
}

function printEvalResult(code, result) {
  const out = formatEvalOutput(code, result);
  console.log(out.dim ? chalk.gray(out.text) : out.text);
}

/** A lost connection reached the terminal as `spawnSync /bin/sh ETIMEDOUT` — a shell, not a state. */
function printEvalError(error) {
  const { lines } = explainEvalError(error && error.message, { panel: inPanel() });
  console.log(chalk.red('✗ ' + lines[0]));
  for (const line of lines.slice(1)) console.log(chalk.gray('  ' + line));
}


program
  .command('eval [code]')
  .description('Execute JavaScript in Figma plugin context')
  .option('-f, --file <path>', 'Run code from file instead of argument')
  .option('--timeout <seconds>', 'How long to wait for the result (default 90)', '90')
  .action(async (code, options) => {
    await checkConnection();
    let jsCode = code ? unescapeShell(code) : code;

    // If --file option provided, read code from file
    if (options.file) {
      if (!existsSync(options.file)) {
        console.log(chalk.red('✗ File not found: ' + options.file));
        return;
      }
      jsCode = readFileSync(options.file, 'utf8');
    }

    if (!jsCode) {
      console.log(chalk.red('✗ No code provided. Use: eval "code" or eval --file /path/to/script.js'));
      return;
    }

    const timeoutMs = evalTimeoutMs(options.timeout);

    // Always prefer async daemon (more reliable, no shell timeout issues)
    if (isDaemonRunning()) {
      try {
        const result = await daemonExec('eval', { code: jsCode }, timeoutMs);
        // Silence used to be the answer for an empty result, which reads exactly like a dead
        // connection. `formatEvalOutput` makes that one decision for `eval` and `run` alike.
        printEvalResult(jsCode, result);
        return;
      } catch (e) {
        // Check if this is a connection/daemon error vs user code error
        const isConnectionError = e.message.includes('ECONNREFUSED') ||
                                  e.message.includes('fetch failed') ||
                                  e.message.includes('network') ||
                                  e.message.includes('timeout') ||
                                  e.message.includes('disconnected');
        if (isConnectionError) {
          // Connection/daemon error - fall back to sync path
          console.log(chalk.yellow('⚠ Daemon error, trying sync path...'));
        } else {
          // User code error - display directly, don't fall back
          printEvalError(e);
          return;
        }
      }
    }

    // Sync fallback (when daemon not running)
    try {
      printEvalResult(jsCode, figmaEvalSync(jsCode));
    } catch (error) {
      printEvalError(error);
    }
  });

// Run command - alias for eval --file (uses async for better performance)
program
  .command('run <file>')
  .description('Run JavaScript file in Figma (alias for eval --file)')
  .option('--timeout <seconds>', 'How long to wait for the result (default 90)', '90')
  .action(async (file, options) => {
    await checkConnection();
    if (!existsSync(file)) {
      console.log(chalk.red('✗ File not found: ' + file));
      return;
    }
    const code = readFileSync(file, 'utf8');
    try {
      // Use async daemon path for better performance with long scripts
      if (isDaemonRunning()) {
        const result = await daemonExec('eval', { code }, evalTimeoutMs(options.timeout));
        printEvalResult(code, result);
      } else {
        // Fallback to sync path. `evalArg` builds the argument — the hand-rolled version that
        // stood here is the one that flattened newlines and cost 60s on a `//` comment.
        figmaUse(evalArg(code));
      }
    } catch (e) {
      printEvalError(e);
    }
  });

// ============ PASSTHROUGH ============

program
  .command('raw <command...>')
  .description('Run raw figma-use command')
  .action((command) => {
    checkConnectionSync();
    figmaUse(command.join(' '));
  });

