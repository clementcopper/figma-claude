import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/index.js');

function run(...args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout) + String(e.stderr) };
  }
}

describe('entry point', () => {
  it('treats a prototype name like any unknown command', () => {
    // `COMMAND_MODULES['toString']` is a function, so the loader called `.map` on it:
    // `TypeError: names.map is not a function` and a stack trace instead of help.
    const { out } = run('toString');
    assert.doesNotMatch(out, /TypeError/);
    assert.match(out, /unknown command/i);
  });

  it('reaches the create subcommands config.js registers', () => {
    const { out } = run('create', 'rect', '--help');
    assert.doesNotMatch(out, /unknown command/i);
    assert.match(out, /Usage: .*create rect/);
  });
});
