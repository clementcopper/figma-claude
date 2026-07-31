import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ALL, COMMAND_MODULES } from '../src/lib/command-map.js';
import { REGISTRY } from '../src/plugins.js';
import { program } from '../src/lib/cli-core.js';

/**
 * Commands a plugin adds at load time (`voice`, `chat`). They only show up in
 * the Commander tree when that plugin is installed under ~/.figma-cli/plugins,
 * so on a clean machine (CI) they are absent — but the map still has to name
 * their module, otherwise the lazy loader can't find them for the users who DO
 * have the plugin. Exempt from the staleness check, checked when present.
 */
const PLUGIN_COMMANDS = new Set(REGISTRY.flatMap((p) => p.commands || []));

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

/**
 * The CLI loads only the module that owns the invoked command, which cuts ~38ms
 * off every single invocation (108ms -> 70ms of startup). The price is a map
 * that can drift out of sync with the code — and drift here is invisible in
 * development and fatal in use: a command whose module is missing from the map
 * silently falls back to loading everything (slow but correct), while a command
 * that FORWARDS to another module's command and doesn't declare it fails at
 * runtime with "unknown command".
 *
 * So the map is checked against the real Commander tree rather than trusted.
 */
describe('lazy command map', () => {
  /** command/alias -> module, derived by loading modules one at a time. */
  const actual = {};

  before(async () => {
    let before = new Set(program.commands.map((c) => c.name()));
    for (const mod of ALL) {
      await import(`../src/commands/${mod}.js`);
      for (const cmd of program.commands) {
        const name = cmd.name();
        if (before.has(name)) continue;
        actual[name] = mod;
        for (const alias of cmd.aliases()) actual[alias] = mod;
      }
      before = new Set(program.commands.map((c) => c.name()));
    }
  });

  it('every registered command and alias is in the map', () => {
    const missing = Object.keys(actual).filter((name) => !COMMAND_MODULES[name]);
    assert.deepStrictEqual(
      missing,
      [],
      `these commands would fall back to loading all modules: ${missing.join(', ')}`
    );
  });

  it('every command maps to the module that actually registers it', () => {
    const wrong = [];
    for (const [name, mod] of Object.entries(actual)) {
      const declared = COMMAND_MODULES[name];
      if (declared && !declared.includes(mod)) {
        wrong.push(`${name}: declared ${declared.join('+')}, registered by ${mod}`);
      }
    }
    assert.deepStrictEqual(wrong, []);
  });

  it('has no entries for commands that no longer exist', () => {
    const stale = Object.keys(COMMAND_MODULES).filter(
      (name) => !actual[name] && !PLUGIN_COMMANDS.has(name)
    );
    assert.deepStrictEqual(stale, []);
  });

  it('names only modules that exist', () => {
    const unknown = [...new Set(Object.values(COMMAND_MODULES).flat())].filter(
      (m) => !ALL.includes(m)
    );
    assert.deepStrictEqual(unknown, []);
  });

  it('declares the modules a command forwards into', () => {
    // `import` hands DESIGN.md work to `tokens import-design-md`. Loading only
    // `setup` would make that fail with "unknown command", so the forward has to
    // be declared. Find every forwarded command name in the source and check it.
    const problems = [];
    for (const mod of ALL) {
      const src = readFileSync(path.join(SRC, 'commands', `${mod}.js`), 'utf8');

      // Attribute each forward to the command whose definition encloses it, by
      // slicing the file at `.command('name'` boundaries.
      const bounds = [...src.matchAll(/\.command\(\s*'([\w-]+)/g)];
      for (let i = 0; i < bounds.length; i++) {
        const owner = bounds[i][1];
        const segment = src.slice(bounds[i].index, bounds[i + 1]?.index ?? src.length);
        // const args = ['tokens', 'import-design-md', ...]  ->  "tokens"
        const targets = new Set(
          [...segment.matchAll(/=\s*\[\s*'([a-z][\w-]*)'[^\]]*\][\s\S]{0,600}?parseAsync\(\s*args/g)]
            .map((m) => m[1])
        );

        for (const target of targets) {
          const targetModule = actual[target];
          if (!targetModule || targetModule === mod) continue;

          // If the enclosing name is a top-level command, only IT needs the
          // dependency. If it is a subcommand (so any entry point into this
          // module could reach the forward), require it of the whole module.
          const owners = COMMAND_MODULES[owner]
            ? [[owner, COMMAND_MODULES[owner]]]
            : Object.entries(COMMAND_MODULES).filter(([, mods]) => mods.includes(mod));

          for (const [name, declared] of owners) {
            if (!declared.includes(targetModule)) {
              problems.push(
                `${name} loads ${mod}, which forwards to "${target}" in ${targetModule} — add it to the map`
              );
            }
          }
        }
      }
    }
    assert.deepStrictEqual([...new Set(problems)], []);
  });
});
