# Ported from claude-terminal-panel

`panel-bridge/` is a copy of `resources/mods/panel-bridge/` in
[`clementcopper/claude-terminal-panel`](https://github.com/clementcopper/claude-terminal-panel),
taken at commit `1164b68` (2026-10-06). That repository is the source; this is the copy that
ships inside the app bundle (`Tools/make-app.sh` puts `mods/` under `Contents/Resources/`).

What differs here: `register.ts` also asks `GET /api/oauth/usage` for the per-model weekly
buckets (`refreshUsage`, the `modelWeeks` field; tests for it at the end of `register.test.ts`),
its header comment names this host's reader, `plugin.json`'s description names FigmaClaude, and
`tsconfig.json` sets `noEmit` so a type check leaves no `.js` beside the sources. Since
2026-10-10 a background agent outlives the turn that spawned it (`keepRunningAgents`,
`clearMainTools`; the test "a background agent outlives…"): the main turn's end asks
`$.agent.list()` instead of dropping every agent, and the host shows the count while idle. The
rest of `register.ts`, `register.test.ts` and `hooks.json` is as in the source — both changes
are worth carrying back there. The file it writes — `<tab id>.live.json` next to
the producer's `<tab id>.json`, fields in `payload()` — is the contract both hosts read.

When the source changes, copy the four files again and re-run `claude plugin test mods/panel-bridge`.
`.claude-plugin/types/` is laid by the engine on first load and is ignored by git.
