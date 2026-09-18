// Command: instantiate — drop an instance of an EXISTING component using the
// reuse handle captured in an extracted DESIGN.md, instead of rebuilding it.
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { program, checkConnection, fastEval } from '../lib/cli-core.js';
import { findComponentSpec } from '../lib/design-spec.js';
import { locateDesignMd } from '../lib/design-md-locate.js';
import { resolveInstancePlan, looksLikeNodeId, planFromNodeId } from '../lib/instance-plan.js';
import { resolveParentCode, pageOfCode } from '../lib/parent-snippet.js';

// Build the async, dynamic-page-safe eval that tries each plan step in order.
// Exported for unit testing. A COMPONENT_SET resolves to its default variant
// (a set has no createInstance). First success wins; failures are collected.
export function instantiateCode(plan, options = {}) {
  const count = Math.max(1, Math.min(200, Number(options.count) || 1));
  const gap = Number.isFinite(Number(options.gap)) ? Number(options.gap) : 24;
  const hasParent = options.parent !== undefined && options.parent !== null && options.parent !== '';
  return `(async () => {
    const plan = ${JSON.stringify(plan)};
    const count = ${count};
    const gap = ${gap};
    const tried = [];
    // Resolved once, before anything is created: a wrong --parent must not leave instances
    // behind on the page the user happened to be looking at. A PAGE is a valid parent too.
    ${resolveParentCode(options.parent)}
    for (const step of plan) {
      try {
        let comp;
        if (step.via === 'key') comp = await figma.importComponentByKeyAsync(step.key);
        else {
          comp = await figma.getNodeByIdAsync(step.id);
          // An id the user read off a live file may be on a page this plugin has not loaded.
          if (!comp) { await figma.loadAllPagesAsync(); comp = await figma.getNodeByIdAsync(step.id); }
          // An id can point at an INSTANCE just as easily as at the component itself.
          if (comp && comp.type === 'INSTANCE') comp = await comp.getMainComponentAsync();
        }
        if (!comp) { tried.push(step.via + ': not found'); continue; }
        if (comp.type === 'COMPONENT_SET') comp = comp.defaultVariant || comp.children[0];
        if (!comp || comp.type !== 'COMPONENT') { tried.push(step.via + ': not a component'); continue; }
        // Where the row starts. Without --parent that is the viewport, as before; inside a
        // container the coordinates are the container's, so they start at its origin. In an
        // auto-layout parent they are not ours to set at all — the layout places the children.
        const base = ${hasParent ? `(__p === figma.currentPage) ? figma.viewport.center : { x: 0, y: 0 }` : `figma.viewport.center`};
        const flow = ${hasParent ? `!!(__p.layoutMode && __p.layoutMode !== 'NONE')` : 'false'};
        const made = [];
        for (let i = 0; i < count; i++) {
          const inst = comp.createInstance();
          if (!flow) {
            // A row, so twenty instances do not land on top of each other.
            inst.x = Math.round(base.x + i * (inst.width + gap));
            inst.y = Math.round(base.y);
          }
          ${hasParent ? '__p' : 'figma.currentPage'}.appendChild(inst);
          made.push(inst);
        }
        // Selection and viewport belong to one page: selecting a node of another page throws.
        const __page = ${pageOfCode('made[0]')};
        if (__page === figma.currentPage) {
          figma.currentPage.selection = made;
          figma.viewport.scrollAndZoomIntoView(made);
        }
        return JSON.stringify({
          ok: true, via: step.via, count: made.length,
          id: made[0].id, ids: made.map(n => n.id), name: made[0].name,
          page: __page ? __page.name : null
        });
      } catch (e) { tried.push(step.via + ': ' + e.message); }
    }
    return JSON.stringify({ ok: false, tried });
  })()`;
}

program
  .command('instantiate <nameOrId>')
  .description('Drop an instance of an EXISTING component — by name from DESIGN.md, or by node id')
  .option('-f, --file <path>', 'DESIGN.md to read (default: auto-locate in cwd / subdirs)')
  .option('--count <n>', 'How many instances to place, in a row', '1')
  .option('--gap <n>', 'Gap between them in px', '24')
  .option('--parent <id>', 'Node to place them in — a frame, or a page id to put them on that page')
  .action(async (name, options) => {
    const placement = { count: options.count, gap: options.gap, parent: options.parent };

    // An id needs no DESIGN.md: it already names the component. This is the route a session has
    // when it read the id off the live file, which is where the CLI's own output points people.
    if (looksLikeNodeId(name)) {
      await checkConnection();
      let res = await fastEval(instantiateCode(planFromNodeId(name), placement));
      if (typeof res === 'string') { try { res = JSON.parse(res); } catch {} }
      if (!res || !res.ok) {
        console.error(chalk.red(`✗ Could not instantiate ${name}.`),
          res?.tried ? chalk.gray('Tried — ' + res.tried.join('; ')) : '');
        process.exit(1);
      }
      console.log(chalk.green(`✓ Instanced "${res.name}" ×${res.count} → ${res.ids.join(', ')}`)
        + (res.page ? chalk.gray(` on page "${res.page}"`) : ''));
      process.exit(0);
    }

    const file = locateDesignMd(options.file);
    if (!file) {
      console.error(chalk.red('✗ No DESIGN.md found.'), 'Run `figma-cli extract` first or pass --file.');
      process.exit(1);
    }
    const md = readFileSync(file, 'utf8');
    const spec = findComponentSpec(md, name);
    if (!spec) {
      console.error(chalk.red(`✗ No component matching "${name}" in ${file}.`));
      process.exit(1);
    }
    if (!spec.reuse) {
      console.error(chalk.red(`✗ No reuse handle for "${spec.name}".`), 'Re-run `figma-cli extract` to capture it.');
      process.exit(1);
    }
    const plan = resolveInstancePlan(spec.reuse);
    await checkConnection();
    let res = await fastEval(instantiateCode(plan, placement));
    if (typeof res === 'string') { try { res = JSON.parse(res); } catch {} }
    if (!res || !res.ok) {
      console.error(chalk.red(`✗ Could not instantiate "${spec.name}".`),
        res?.tried ? chalk.gray('Tried — ' + res.tried.join('; ')) : '');
      process.exit(1);
    }
    console.log(chalk.green(
      `✓ Instanced ${JSON.stringify(spec.name)} via ${res.via}` +
      (res.count > 1 ? ` ×${res.count} → ${res.ids.join(', ')}` : ` → ${res.id}`)
    ) + (res.page ? chalk.gray(` on page "${res.page}"`) : ''));
    process.exit(0);
  });
