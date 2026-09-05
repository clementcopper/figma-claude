// Commands: variables (extracted from index.js)
import chalk from 'chalk';
import { deletePlan, deleteNodesCode, formatDeleteResult } from '../lib/delete-nodes.js';
import { parseIdList, ID_LIST_HELP } from '../lib/id-list.js';
import { writeFileSync } from 'fs';
import ora from 'ora';
import { join } from 'path';
import {
  program,
  checkConnection,
  checkConnectionSync,
  daemonExec,
  fastEval,
  figmaEvalSync,
  figmaUse,
  handleEvalError,
  hexToRgb
} from '../lib/cli-core.js';
import { evalArg } from '../lib/eval-arg.js';
import { variablesExportCode, shapeExport, summarize } from '../lib/variables-export.js';
import { COLOR_SNIPPET } from '../lib/plugin-color.js';

// ============ VARIABLES ============

const variables = program
  .command('variables')
  .alias('var')
  .description('Manage design tokens/variables');

/**
 * Plugin code for `var list`. The collection filter is the `var delete-all -c` rule:
 * case-insensitive, whole name or substring. Returns { name, type, collection } per variable.
 */
export function listVariablesCode({ collection, type } = {}) {
  const colFilter = collection
    ? `const fl = ${JSON.stringify(collection.toLowerCase())};
cols = cols.filter(c => c.name.toLowerCase() === fl || c.name.toLowerCase().includes(fl));`
    : '';
  const typeFilter = type ? `.filter(v => v.resolvedType === ${JSON.stringify(type.toUpperCase())})` : '';
  return `(async () => {
let cols = await figma.variables.getLocalVariableCollectionsAsync();
${colFilter}
const byId = {};
for (const c of cols) byId[c.id] = c.name;
const vars = (await figma.variables.getLocalVariablesAsync()).filter(v => byId[v.variableCollectionId])${typeFilter};
return vars.map(v => ({ name: v.name, type: v.resolvedType, collection: byId[v.variableCollectionId] }));
})()`;
}

variables
  .command('list')
  .description('List local variables (name, type, collection)')
  .option('-c, --collection <name>', 'Only this collection (case-insensitive, whole name or substring)')
  .option('-t, --type <type>', 'Only this type: COLOR, FLOAT, STRING, BOOLEAN')
  .option('--json', 'Print a JSON array of { name, type, collection }')
  .action(async (options) => {
    await checkConnection();
    try {
      const vars = await fastEval(listVariablesCode(options));
      if (options.json) { console.log(JSON.stringify(vars || [])); return; }
      if (!vars || !vars.length) {
        const scope = [options.collection && `in a collection matching ${JSON.stringify(options.collection)}`, options.type && `of type ${options.type.toUpperCase()}`].filter(Boolean).join(' ');
        console.log(chalk.yellow(scope ? `No variables ${scope}` : 'No local variables'));
        return;
      }
      for (const v of vars) console.log(`${v.name} (${v.type})  ${chalk.gray(v.collection)}`);
    } catch (e) {
      handleEvalError(e);
    }
  });

variables
  .command('create <name>')
  .description('Create a variable')
  .requiredOption('-c, --collection <id>', 'Collection ID or name')
  .requiredOption('-t, --type <type>', 'Type: COLOR, FLOAT, STRING, BOOLEAN')
  .option('-v, --value <value>', 'Initial value')
  .action((name, options) => {
    checkConnectionSync();
    const type = options.type.toUpperCase();
    const code = `(async () => {
const cols = await figma.variables.getLocalVariableCollectionsAsync();
let col = cols.find(c => c.id === ${JSON.stringify(options.collection)} || c.name === ${JSON.stringify(options.collection)});
if (!col) return 'Collection not found: ' + ${JSON.stringify(options.collection)};
const modeId = col.modes[0].modeId;

${COLOR_SNIPPET}

const v = figma.variables.createVariable(${JSON.stringify(name)}, col, ${JSON.stringify(type)});
${options.value ? `
let figmaValue = ${JSON.stringify(options.value)};
if (${JSON.stringify(type)} === 'COLOR') figmaValue = hexToRgb(${JSON.stringify(options.value)});
else if (${JSON.stringify(type)} === 'FLOAT') figmaValue = parseFloat(${JSON.stringify(options.value)});
else if (${JSON.stringify(type)} === 'BOOLEAN') figmaValue = ${JSON.stringify(options.value)} === 'true';
v.setValueForMode(modeId, figmaValue);
` : ''}
return ${JSON.stringify(`Created ${type.toLowerCase()} variable: ${name}`)};
})()`;
    figmaUse(evalArg(code), { silent: false });
  });

/** What `var export` prints: the shaped JSON, or a one-line summary. */
export function varExportOutput(raw, options) {
  const shaped = shapeExport(raw);
  return options.json ? JSON.stringify(shaped, null, 2) : summarize(shaped);
}

variables
  .command('export')
  .description('Read every local collection, variable (aliases with target name AND resolved value) and text style out of the file')
  .option('--json', 'Print the full JSON (pipe it into a file)')
  .option('-o, --output <file>', 'Write the JSON to a file')
  .action(async (options) => {
    await checkConnection();
    const raw = await fastEval(variablesExportCode());
    if (options.output) {
      writeFileSync(options.output, JSON.stringify(shapeExport(raw), null, 2) + '\n');
      console.log(chalk.green('✓ ' + summarize(shapeExport(raw)) + ' → ' + options.output));
      return;
    }
    console.log(varExportOutput(raw, options));
  });

variables
  .command('find <pattern>')
  .description('Find variables by name pattern')
  .action((pattern) => {
    checkConnectionSync();
    figmaUse(`variable find "${pattern}"`);
  });

variables
  .command('visualize [collection]')
  .description('Create color swatches on canvas (shadcn-style layout)')
  .action(async (collection, options) => {
    await checkConnection();
    const spinner = ora('Creating color palette...').start();

    const code = `(async () => {
await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

const collections = await figma.variables.getLocalVariableCollectionsAsync();
const colorVars = await figma.variables.getLocalVariablesAsync('COLOR');

const targetCols = ${collection ? `collections.filter(c => c.name.toLowerCase().includes(${JSON.stringify(collection)}.toLowerCase()))` : 'collections'};
if (targetCols.length === 0) return 'No collections found';

// Skip semantic collections (they're aliases, colors already shown in primitives)
const filteredCols = targetCols.filter(c => !c.name.toLowerCase().includes('semantic'));
if (filteredCols.length === 0) return 'No color collections found (only semantic)';

let startX = 0;
figma.currentPage.children.forEach(n => {
  startX = Math.max(startX, n.x + (n.width || 0));
});
startX += 100;

let totalSwatches = 0;

// shadcn color order
const colorOrder = ['slate','gray','zinc','neutral','stone','red','orange','amber','yellow','lime','green','emerald','teal','cyan','sky','blue','indigo','violet','purple','fuchsia','pink','rose','white','black'];

for (const col of filteredCols) {
  const colVars = colorVars.filter(v => v.variableCollectionId === col.id);
  if (colVars.length === 0) continue;

  // Group by prefix (handles both "blue/500" and semantic names)
  const groups = {};
  const semanticGroups = {
    'background': 'base', 'foreground': 'base', 'border': 'base', 'input': 'base', 'ring': 'base',
    'primary': 'primary', 'primary-foreground': 'primary',
    'secondary': 'secondary', 'secondary-foreground': 'secondary',
    'muted': 'muted', 'muted-foreground': 'muted',
    'accent': 'accent', 'accent-foreground': 'accent',
    'card': 'card', 'card-foreground': 'card',
    'popover': 'popover', 'popover-foreground': 'popover',
    'destructive': 'destructive', 'destructive-foreground': 'destructive',
    'chart-1': 'chart', 'chart-2': 'chart', 'chart-3': 'chart', 'chart-4': 'chart', 'chart-5': 'chart',
  };
  colVars.forEach(v => {
    const parts = v.name.split('/');
    let prefix;
    if (parts.length > 1) {
      prefix = parts[0];
    } else if (v.name.startsWith('sidebar-')) {
      prefix = 'sidebar';
    } else {
      prefix = semanticGroups[v.name] || 'other';
    }
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(v);
  });

  // Sort groups
  const semanticOrder = ['base','primary','secondary','muted','accent','card','popover','destructive','chart','sidebar'];
  const sortedGroups = Object.entries(groups).sort((a, b) => {
    const aColorIdx = colorOrder.indexOf(a[0]);
    const bColorIdx = colorOrder.indexOf(b[0]);
    const aSemanticIdx = semanticOrder.indexOf(a[0]);
    const bSemanticIdx = semanticOrder.indexOf(b[0]);
    if (aColorIdx !== -1 && bColorIdx !== -1) return aColorIdx - bColorIdx;
    if (aColorIdx !== -1) return -1;
    if (bColorIdx !== -1) return 1;
    if (aSemanticIdx !== -1 && bSemanticIdx !== -1) return aSemanticIdx - bSemanticIdx;
    return a[0].localeCompare(b[0]);
  });

  // Create container
  const container = figma.createFrame();
  container.name = col.name;
  container.x = startX;
  container.y = 0;
  container.layoutMode = 'VERTICAL';
  container.primaryAxisSizingMode = 'AUTO';
  container.counterAxisSizingMode = 'AUTO';
  container.itemSpacing = 8;
  container.paddingTop = 32;
  container.paddingBottom = 32;
  container.paddingLeft = 32;
  container.paddingRight = 32;
  container.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  container.cornerRadius = 16;

  // Title
  const title = figma.createText();
  title.characters = col.name;
  title.fontSize = 20;
  title.fontName = { family: 'Inter', style: 'Medium' };
  title.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }];
  container.appendChild(title);

  // Spacer
  const spacer = figma.createFrame();
  spacer.resize(1, 16);
  spacer.fills = [];
  container.appendChild(spacer);

  const modeId = col.modes[0].modeId;
  const swatchesToBind = [];

  for (const [groupName, vars] of sortedGroups) {
    // Row container with label
    const rowContainer = figma.createFrame();
    rowContainer.name = groupName;
    rowContainer.layoutMode = 'HORIZONTAL';
    rowContainer.primaryAxisSizingMode = 'AUTO';
    rowContainer.counterAxisSizingMode = 'AUTO';
    rowContainer.itemSpacing = 16;
    rowContainer.counterAxisAlignItems = 'CENTER';
    rowContainer.fills = [];
    container.appendChild(rowContainer);

    // Label
    const label = figma.createText();
    label.characters = groupName;
    label.fontSize = 13;
    label.fontName = { family: 'Inter', style: 'Medium' };
    label.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }];
    label.resize(80, label.height);
    label.textAlignHorizontal = 'RIGHT';
    rowContainer.appendChild(label);

    // Swatches row
    const swatchRow = figma.createFrame();
    swatchRow.layoutMode = 'HORIZONTAL';
    swatchRow.primaryAxisSizingMode = 'AUTO';
    swatchRow.counterAxisSizingMode = 'AUTO';
    swatchRow.itemSpacing = 0;
    swatchRow.fills = [];
    swatchRow.cornerRadius = 6;
    swatchRow.clipsContent = true;
    rowContainer.appendChild(swatchRow);

    // Sort shades
    vars.sort((a, b) => {
      const aNum = parseInt(a.name.split('/').pop()) || 0;
      const bNum = parseInt(b.name.split('/').pop()) || 0;
      return aNum - bNum;
    });

    for (const v of vars) {
      const swatch = figma.createFrame();
      swatch.name = v.name;
      swatch.resize(48, 32);
      swatch.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
      swatchRow.appendChild(swatch);
      swatchesToBind.push({ swatch, variable: v, modeId });
      totalSwatches++;
    }
  }

  // Bind after appending. A failure here used to be swallowed, so every aliased swatch
  // rendered grey without a word (the sync getVariableById throws under dynamic-page).
  const bindFailures = [];
  for (const { swatch, variable, modeId } of swatchesToBind) {
    try {
      let value = variable.valuesByMode[modeId];
      if (value && value.type === 'VARIABLE_ALIAS') {
        const resolved = await figma.variables.getVariableByIdAsync(value.id);
        if (resolved) value = resolved.valuesByMode[Object.keys(resolved.valuesByMode)[0]];
      }
      if (value && value.r !== undefined) {
        swatch.fills = [figma.variables.setBoundVariableForPaint(
          { type: 'SOLID', color: { r: value.r, g: value.g, b: value.b } }, 'color', variable
        )];
      }
    } catch (e) { bindFailures.push(variable.name + ': ' + e.message); }
  }

  startX += container.width + 60;
}

figma.viewport.scrollAndZoomIntoView(figma.currentPage.children.slice(-filteredCols.length));
return 'Created ' + totalSwatches + ' color swatches' + (bindFailures.length ? '\\n⚠ ' + bindFailures.length + ' swatch(es) not bound: ' + bindFailures.slice(0, 5).join('; ') : '');
})()`;

    try {
      const result = await fastEval(code);
      spinner.succeed(result || 'Created color palette');
    } catch (error) {
      spinner.fail('Failed to create palette'); process.exitCode = 1;
      console.error(chalk.red(error.message));
    }
  });

variables
  .command('create-batch <json>')
  .description('Create multiple variables at once (faster than individual calls)')
  .requiredOption('-c, --collection <id>', 'Collection ID or name')
  .action((json, options) => {
    checkConnectionSync();
    let vars;
    try {
      vars = JSON.parse(json);
    } catch {
      console.log(chalk.red('Invalid JSON. Expected: [{"name": "color/red", "type": "COLOR", "value": "#ff0000"}, ...]'));
      return;
    }
    if (!Array.isArray(vars)) {
      console.log(chalk.red('Expected JSON array'));
      return;
    }

    const code = `(async () => {
const vars = ${JSON.stringify(vars)};
const cols = await figma.variables.getLocalVariableCollectionsAsync();
let col = cols.find(c => c.id === ${JSON.stringify(options.collection)} || c.name === ${JSON.stringify(options.collection)});
if (!col) return 'Collection not found: ' + ${JSON.stringify(options.collection)};
const modeId = col.modes[0].modeId;

${COLOR_SNIPPET}

let created = 0;
for (const v of vars) {
  const type = (v.type || 'COLOR').toUpperCase();
  const variable = figma.variables.createVariable(v.name, col, type);
  if (v.value !== undefined) {
    let figmaValue = v.value;
    if (type === 'COLOR') figmaValue = hexToRgb(v.value);
    else if (type === 'FLOAT') figmaValue = parseFloat(v.value);
    else if (type === 'BOOLEAN') figmaValue = v.value === true || v.value === 'true';
    variable.setValueForMode(modeId, figmaValue);
  }
  created++;
}
return 'Created ' + created + ' variables';
})()`;

    const result = figmaEvalSync(code);
    console.log(chalk.green(result || `✓ Created ${vars.length} variables`));
  });

/**
 * Plugin code for `var delete-all`. Without --yes it only counts what would go; the
 * collection filter is case-insensitive and matches whole name or substring, the same
 * rule `var list -c` applies — it used to be case-sensitive here, so `-c shadcn` deleted
 * nothing when the collection was "Shadcn/primitives" and a typo'd flag deleted everything.
 */
export function deleteAllCode({ yes, collection } = {}) {
  const filterCode = collection
    ? `const fl = ${JSON.stringify(collection.toLowerCase())};
cols = cols.filter(c => c.name.toLowerCase() === fl || c.name.toLowerCase().includes(fl));`
    : '';
  return `(async () => {
let cols = await figma.variables.getLocalVariableCollectionsAsync();
${filterCode}
const vars = await figma.variables.getLocalVariablesAsync();
let count = 0;
const lines = [];
for (const col of cols) {
  const colVars = vars.filter(v => v.variableCollectionId === col.id);
  lines.push(col.name + ' (' + colVars.length + ' variables)');
  ${yes ? 'for (const v of colVars) v.remove(); col.remove();' : ''}
  count += colVars.length;
}
return ${yes
    ? "'Deleted ' + count + ' variables and ' + cols.length + ' collections'"
    : "'Would delete ' + count + ' variables in ' + cols.length + ' collection(s):\\n  ' + lines.join('\\n  ') + '\\nRe-run with --yes to delete.'"};
})()`;
}

variables
  .command('delete-all')
  .description('Delete all local variables and collections (previews unless --yes)')
  .option('-c, --collection <name>', 'Only delete variables in this collection (case-insensitive)')
  .option('-y, --yes', 'Actually delete; without it the command only lists what would go')
  .action((options) => {
    checkConnectionSync();
    const spinner = ora(options.yes ? 'Deleting variables...' : 'Counting variables...').start();
    const code = deleteAllCode(options);

    try {
      const result = figmaEvalSync(code);
      if (options.yes) spinner.succeed(result);
      else { spinner.warn(result); process.exitCode = 1; }
    } catch (error) {
      spinner.fail('Failed to delete variables'); process.exitCode = 1;
      console.error(chalk.red(error.message));
    }
  });

// ============ BATCH OPERATIONS ============

program
  .command('delete-batch <nodeIds>')
  .description(`Delete multiple nodes at once (${ID_LIST_HELP})`)
  .action(async (nodeIds) => {
    await checkConnection();
    const ids = parseIdList(nodeIds);
    if (!ids.length) { console.error(chalk.red('✗ No ids given')); process.exitCode = 1; return; }
    try {
      const result = await fastEval(deleteNodesCode(ids));
      const report = formatDeleteResult(result);
      for (const line of report.lines) console.log(line.startsWith('✓') ? chalk.green(line) : line.startsWith('○') ? chalk.yellow(line) : chalk.gray(line));
      process.exitCode = report.exitCode;
    } catch (e) {
      handleEvalError(e);
    }
  });

/**
 * Plugin code for `bind-batch`. Each entry is guarded on its own and reported on its own:
 * one bad entry (a COLOR variable on cornerRadius) used to throw inside the loop, abort the
 * eval, and lose every binding after it behind a generic error. Number properties check the
 * variable's resolvedType first, so the message names the mismatch instead of Figma's.
 */
export function bindBatchCode(bindings) {
  return `(async () => {
const bindings = ${JSON.stringify(bindings)};
const vars = await figma.variables.getLocalVariablesAsync();
const results = [];
const NUMBER_PROPS = { radius: ['cornerRadius'], gap: ['itemSpacing'], padding: ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'] };

for (const b of bindings) {
  const entry = { nodeId: b.nodeId, property: b.property, variable: b.variable, ok: false };
  results.push(entry);
  try {
    const node = await figma.getNodeByIdAsync(b.nodeId);
    if (!node) { entry.error = 'node not found'; continue; }
    const variable = vars.find(v => v.name === b.variable || v.name.endsWith('/' + b.variable));
    if (!variable) { entry.error = 'variable not found'; continue; }
    const prop = String(b.property || '').toLowerCase();

    if (prop === 'fill' || prop === 'stroke') {
      if (variable.resolvedType !== 'COLOR') { entry.error = 'variable is ' + variable.resolvedType + ', needs COLOR'; continue; }
      const key = prop === 'fill' ? 'fills' : 'strokes';
      if (!(key in node) || !node[key].length) { entry.error = 'node has no ' + key; continue; }
      const paints = JSON.parse(JSON.stringify(node[key]));
      paints[0] = figma.variables.setBoundVariableForPaint(paints[0], 'color', variable);
      node[key] = paints;
      entry.ok = true;
    } else if (NUMBER_PROPS[prop]) {
      if (variable.resolvedType !== 'FLOAT') { entry.error = 'variable is ' + variable.resolvedType + ', needs FLOAT'; continue; }
      const fields = NUMBER_PROPS[prop];
      if (!(fields[0] in node)) { entry.error = 'node has no ' + fields[0]; continue; }
      for (const field of fields) node.setBoundVariable(field, variable);
      entry.ok = true;
    } else {
      entry.error = 'unknown property (fill, stroke, radius, gap, padding)';
    }
  } catch (e) {
    entry.error = e.message;
  }
}
const bound = results.filter(r => r.ok).length;
return { bound, failed: results.filter(r => !r.ok) };
})()`;
}

program
  .command('bind-batch <json>')
  .description('Bind variables to multiple nodes at once')
  .action((json) => {
    checkConnectionSync();
    let bindings;
    try {
      bindings = JSON.parse(json);
    } catch {
      console.log(chalk.red('Invalid JSON. Expected: [{"nodeId": "1:234", "property": "fill", "variable": "primary/500"}, ...]'));
      return;
    }

    const code = bindBatchCode(bindings);

    const result = figmaEvalSync(code);
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    console.log(chalk.green(`✓ Bound ${parsed.bound} of ${bindings.length}`));
    for (const f of parsed.failed) console.log(chalk.red(`  ✗ ${f.nodeId} ${f.property} ← ${f.variable}: ${f.error}`));
    if (parsed.failed.length) process.exitCode = 1;
  });

program
  .command('set-batch <json>')
  .description('Set properties on multiple nodes at once. Each entry: {id|nodeId, fill?, stroke?, strokeWidth?, radius?, opacity?, name?, visible?, x?, y?, width?, height?}. fill/stroke accept hex ("#ff0000") OR variable references ("var:primary", "var:colors/brand-blue", "var:miro:primary") — variable references stay BOUND so theme switches work later.')
  .option('-c, --collection <name>', 'Pin var:<name> resolution to this collection (same as render --collection).')
  .action(async (json, options) => {
    await checkConnection();
    let operations;
    try {
      operations = JSON.parse(json);
    } catch {
      console.log(chalk.red('Invalid JSON. Expected: [{"id": "1:234", "fill": "#ff0000" OR "var:primary", ...}, ...]'));
      return;
    }
    // Normalize id/nodeId (LLMs reach for `id`). Also tolerate `newName`/`label` for `name`.
    operations = operations.map(op => ({
      ...op,
      nodeId: op.nodeId ?? op.id,
      name: op.name ?? op.newName ?? op.label,
    }));
    const colFilter = options.collection || null;

    const code = `(async () => {
const operations = ${JSON.stringify(operations)};
const colFilter = ${JSON.stringify(colFilter)};

${COLOR_SNIPPET}

// Load the variable map once, with the same scoping rules as render.
const [allCols, allVars] = await Promise.all([
  figma.variables.getLocalVariableCollectionsAsync(),
  figma.variables.getLocalVariablesAsync(),
]);
let scoped = null;
if (colFilter) {
  const fl = colFilter.toLowerCase();
  const cols = allCols.filter(c => c.name.toLowerCase() === fl || c.name.toLowerCase().includes(fl));
  scoped = new Set(cols.map(c => c.id));
}
const shadcnIds = new Set(allCols.filter(c => c.name.startsWith('shadcn')).map(c => c.id));
const varCache = {};
const register = (v) => {
  if (!varCache[v.name]) varCache[v.name] = v;
  const slash = v.name.lastIndexOf('/');
  if (slash >= 0) {
    const tail = v.name.slice(slash + 1);
    if (tail && !varCache[tail]) varCache[tail] = v;
  }
};
const qualified = {};
for (const v of allVars) {
  const col = allCols.find(c => c.id === v.variableCollectionId);
  if (!col) continue;
  qualified[col.name.toLowerCase() + ':' + v.name] = v;
  const slash = v.name.lastIndexOf('/');
  if (slash >= 0) qualified[col.name.toLowerCase() + ':' + v.name.slice(slash + 1)] = v;
}
if (scoped) {
  for (const v of allVars) if (scoped.has(v.variableCollectionId)) register(v);
} else {
  for (const v of allVars) if (shadcnIds.has(v.variableCollectionId)) register(v);
  for (const v of allVars) if (!shadcnIds.has(v.variableCollectionId)) register(v);
}
const lookupVar = (ref) => {
  // Accept "primary", "colors/primary", "miro:primary" — return Variable or null
  if (ref.includes(':')) {
    const [cn, vn] = ref.split(':', 2);
    return qualified[cn.toLowerCase() + ':' + vn] || varCache[vn] || null;
  }
  return varCache[ref] || null;
};
const setPaintColor = (input) => {
  // Returns a Paint with a SOLID color, either hex (frozen) or variable-bound.
  if (typeof input === 'string' && input.startsWith('var:')) {
    const ref = input.slice(4);
    const v = lookupVar(ref);
    if (!v) return { _err: 'variable not found: ' + ref };
    return figma.variables.setBoundVariableForPaint(
      { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }, 'color', v
    );
  }
  const rgb = hexToRgb(input);
  return rgb ? { type: 'SOLID', color: rgb } : { _err: 'invalid color: ' + input };
};

let updated = 0;
const notFound = [];
const errors = [];

for (const op of operations) {
  const node = await figma.getNodeByIdAsync(op.nodeId);
  if (!node) { notFound.push(op.nodeId); continue; }
  let touched = false;

  if (op.fill !== undefined && 'fills' in node) {
    const paint = setPaintColor(op.fill);
    if (paint._err) errors.push(op.nodeId + ': ' + paint._err);
    else { node.fills = [paint]; touched = true; }
  }
  if (op.stroke !== undefined && 'strokes' in node) {
    const paint = setPaintColor(op.stroke);
    if (paint._err) errors.push(op.nodeId + ': ' + paint._err);
    else { node.strokes = [paint]; touched = true; }
  }
  if (op.strokeWidth !== undefined && 'strokeWeight' in node) { node.strokeWeight = op.strokeWidth; touched = true; }
  if (op.radius !== undefined && 'cornerRadius' in node) { node.cornerRadius = op.radius; touched = true; }
  if (op.opacity !== undefined && 'opacity' in node) { node.opacity = op.opacity; touched = true; }
  if (op.name && 'name' in node) { node.name = op.name; touched = true; }
  if (op.visible !== undefined && 'visible' in node) { node.visible = op.visible; touched = true; }
  if (op.x !== undefined) { node.x = op.x; touched = true; }
  if (op.y !== undefined) { node.y = op.y; touched = true; }
  if (op.width !== undefined && op.height !== undefined && 'resize' in node) {
    node.resize(op.width, op.height); touched = true;
  }
  if (touched) updated++;
}
return { updated, notFound, errors };
})()`;

    try {
      const r = await daemonExec('eval', { code });
      const data = typeof r === 'string' ? (() => { try { return JSON.parse(r); } catch { return null; } })() : r;
      if (data && typeof data === 'object' && 'updated' in data) {
        console.log(chalk.green(`✓ Updated ${data.updated} node(s)`));
        if (data.notFound && data.notFound.length) {
          console.log(chalk.yellow(`  ⚠ ${data.notFound.length} ID(s) not found: ${data.notFound.join(', ')}`));
        }
        if (data.errors && data.errors.length) {
          for (const e of data.errors) console.log(chalk.yellow('  ⚠ ' + e));
        }
      } else {
        console.log(chalk.green(r || `✓ Updated nodes`));
      }
    } catch (e) {
      handleEvalError(e);
    }
  });

program
  .command('rename-batch <json>')
  .description('Rename multiple nodes at once. Accepts [{id|nodeId,name}, …] or {"<id>": "<name>", …}.')
  .action((json) => {
    checkConnectionSync();
    let renames;
    try {
      renames = JSON.parse(json);
    } catch {
      console.log(chalk.red('Invalid JSON. Expected: [{"id": "1:234", "name": "New Name"}, ...] or {"1:234": "New Name", ...}'));
      return;
    }

    // Support both array and object format. Array form: accept BOTH "id" and
    // "nodeId" as the ID key — LLMs reach for "id" more naturally and were
    // silently getting 0 renames before.
    let pairs;
    if (Array.isArray(renames)) {
      pairs = renames.map(r => ({ id: r.id ?? r.nodeId, name: r.name ?? r.newName }));
    } else {
      pairs = Object.entries(renames).map(([id, name]) => ({ id, name }));
    }
    const missing = pairs.filter(p => !p.id || !p.name);
    if (missing.length) {
      console.log(chalk.red(`✗ ${missing.length} entr${missing.length === 1 ? 'y is' : 'ies are'} missing id or name. Expected each entry to have both.`)); process.exitCode = 1;
      return;
    }

    const code = `(async () => {
const pairs = ${JSON.stringify(pairs)};
let renamed = 0;
const notFound = [];
for (const p of pairs) {
  const node = await figma.getNodeByIdAsync(p.id);
  if (node) {
    node.name = p.name;
    renamed++;
  } else {
    notFound.push(p.id);
  }
}
return { renamed, notFound };
})()`;

    const result = figmaEvalSync(code);
    let parsed;
    try { parsed = typeof result === 'string' ? JSON.parse(result.trim()) : result; } catch { parsed = null; }
    if (parsed && typeof parsed === 'object') {
      console.log(chalk.green(`✓ Renamed ${parsed.renamed} node(s)`));
      if (parsed.notFound && parsed.notFound.length) {
        console.log(chalk.yellow(`  ⚠ ${parsed.notFound.length} ID(s) not found: ${parsed.notFound.join(', ')}`));
      }
    } else {
      console.log(chalk.green(result || `✓ Renamed nodes`));
    }
  });

