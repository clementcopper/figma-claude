#!/usr/bin/env node

// figma-ds-cli entry point. The CLI core (daemon plumbing, eval helpers,
// config, the Commander program) lives in lib/cli-core.js; every command group
// registers itself as an import side effect.
//
// Only the module that owns the invoked command is loaded. Importing all 25
// command modules costs ~42ms, and startup dominates a typical command: `eval`
// takes ~140ms end to end, of which ~110ms was process start and module load
// and only ~30ms the actual Figma roundtrip. Skipping the modules a command
// doesn't need takes startup to ~67ms.
//
// Anything unrecognised — --help, an unknown command, no arguments — falls back
// to loading everything, so help output and "did you mean" suggestions stay
// complete. Correctness first, speed only on the path we can be sure about.
import { program } from './lib/cli-core.js';
import { ALL, COMMAND_MODULES } from './lib/command-map.js';

const load = (names) =>
  Promise.all(names.map((n) => import(`./commands/${n}.js`)));

const invoked = process.argv[2];
await load(
  invoked && COMMAND_MODULES[invoked] ? COMMAND_MODULES[invoked] : ALL
);

program.parse();
