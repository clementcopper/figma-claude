# Feedback from the panel

What figma-claude runs into while using this CLI from inside FigmaClaude.app, written down where
it happened. **Filing:** figma-claude, in the moment of the friction — the rule it reads is the
`## figma-cli Feedback` section in `~/.claude/CLAUDE.md`, written by `bin/fig-feedback-setup`.
**Emptying:** `/feedback-triage` in a session here.

An entry is an observation, not a diagnosis. figma-claude cannot see this repo's source; what it
can see is the command it ran and what came back, and that is what belongs here.

Written from every machine that runs the panel, so `.gitattributes` merges this file with
`merge=union` — parallel entries survive instead of conflicting. A new machine needs
`bin/fig-feedback-setup` once; the rule and the write permission live in `~/.claude`, which git
does not carry.

## Format

One `- [ ] ` per entry — a `SessionStart` hook counts that prefix to say how many are open, so it
is a format rule rather than a matter of taste. It counts **inside `## Open` only**, so the
template below and everything in `## Done` stay uncounted; `grep -c` over the whole file is the
wrong instrument and reports one too many. Tag each entry with the area it concerns:

| Tag | Concerns |
|---|---|
| `cli` | a command fails, or does something other than documented |
| `docs` | `docs/FIGMA-USAGE.md` or `REFERENCE.md` is wrong or silent about something |
| `app` | friction in FigmaClaude.app itself — buttons, status, tabs, status line |
| `wish` | a command that is missing |
| `loop` | this loop itself — the installer, the rule in `~/.claude`, the triggers, this file |

```markdown
- [ ] `cli` · **One line: what happened, not what you think causes it**
  **Repro:** the command, verbatim
  **Observed:** what came back
  **Expected:** what the docs or the obvious reading promised
  **Context:** CLI version, mode, Figma file
```

Append new entries at the end of **Open**; never rewrite one that is already there.

## Open

<!-- new entries go here -->

## Done

<!-- triaged entries, each with a → line naming where it went -->

- [x] `cli` · **`eval` prints the return value; `console.log` output never appears**
  **Repro:** `figma-cli eval --file readstyles.js` where the script ends in
  `console.log(JSON.stringify(...))`
  **Observed:** no output at all, exit code 0
  **Expected:** either the logged text, or a hint that only the return value is printed. A
  logging script and a broken connection look identical from the terminal.
  **Context:** 2.1.2, daemon on 3456, file m2trust
  → `eval` now names the silence; hint in `src/lib/eval-output.js` + `tests/eval-output.test.js`,
    documented in `REFERENCE.md`

- [x] `wish` · **No command to instantiate a component**
  **Repro:** needed 20 instances of `Icon-Bulletpoint / Type=small` `15121:131077`
  **Observed:** `create` offers frame / icon / image only; `duplicate` needs an existing node
  **Expected:** something like `figma-cli instance <componentId> --count N`. Without it the only
  route is `createInstance()` inside `eval`, which the golden rules discourage.
  **Context:** 2.1.2, file m2trust
  → built: `instantiate <id> --count N --gap N` (`src/commands/instantiate.js`,
    `looksLikeNodeId`/`planFromNodeId` in `src/lib/instance-plan.js`), documented in `REFERENCE.md`.
    Verified live: `instantiate 15121:131077 --count 3` placed a row, instances removed again

- [x] `cli` · **`duplicate` cannot take a nested instance id**
  **Repro:** `figma-cli duplicate "I16451:71866;2029:67533;2151:87636" --offset 0`
  **Observed:** the only reachable instances of several components sit inside other instances, so
  there is nothing to duplicate
  **Expected:** either a duplicate that lands as a sibling of the outer instance, or an error
  saying nested ids are not supported
  **Context:** 2.1.2, file m2trust
  → fixed, but not the reported cause: nested ids resolve and clone fine. `duplicate` now runs
    through the daemon, loads other pages only when the first lookup misses, and puts the copy
    next to the outermost instance (`src/commands/canvas-ops.js`, `tests/duplicate-cmd.test.js`).
    The 60 s `ETIMEDOUT` seen while fixing this was self-inflicted — a flattened `//` comment,
    see `.claude/bugs-and-fixes.md`; it was not the state you reported

- [x] `cli` · **`render` matches text styles against a different naming scheme and renders anyway**
  **Repro:** `figma-cli render '<Frame ...><Text size={43} lineHeight={64.5} weight="medium">Your role</Text></Frame>' -c Colors`
  **Observed:** `⚠ no text style for 43px Medium — nearest: "tex/xl/medium" (24px Medium)`, then the
  frame renders with the text on **no** style. The file has `Website/H3` at exactly 43/64.5.
  **Expected:** either a match against `Website/*` too, or a warning that says the node was left
  unstyled. The nearest-match line reads like it applied something.
  **Context:** 2.1.2, file m2trust, 47 text styles in two schemes (`Website/*` and `tex/*`)
  → real bug, fixed: the weight comparison kept the family prefix, so `weight="medium"` could
    never match Aeonik's `Text Medium`. `weightKey()` in `src/lib/text-styles.js`, embedded into
    the eval prelude; `tests/text-styles.test.js`. Verified in the reporter's own file: the same
    command now reports `text styles: Website/H3`

- [x] `cli` · **`config` has no `list`**
  **Repro:** `figma-cli config list`
  **Observed:** `error: unknown command 'list'`
  **Expected:** `--help` shows only `set` and `get`, so listing needs a key you already know.
  **Context:** 2.1.2
  → built: `config list` (`src/lib/config-view.js`, `tests/config-view.test.js`). Credential
    values are never printed — the row says `set, N characters`

- [x] `cli` · **An `eval` that walks all pages exceeds the timeout with no partial output**
  **Repro:** `figma-cli eval` with a recursive walk over `figma.root.children` looking for a
  component by name
  **Observed:** no return after 120s, killed
  **Expected:** either a faster node lookup (`find` works per page) or a documented ceiling. The
  workaround was reading `mainComponent.id` off a known instance instead.
  **Context:** 2.1.2, file m2trust (~91 top-level frames on one page)
  → `eval --timeout <seconds>` raises the ceiling, and it is documented in `REFERENCE.md`.
    Still no partial output: a walk either answers or is killed

- [x] `docs` · **This file points at a rule path that does not exist here**
  **Repro:** FEEDBACK.md line 5 — "see `Business/.claude/rules/figma-design.md`"
  **Observed:** no such file reachable from this machine's session. The rule I actually carry is a
  `## figma-cli Feedback` section in `~/.claude/CLAUDE.md`; the project rule file
  `Website/.claude/rules/figma-cli.md` is usage-only and says nothing about filing feedback.
  **Expected:** the pointer names the file the panel session really reads.
  **Context:** 2.1.2, session in /Users/danielmartin/Website
  → fixed: the pointer named a path from another machine. `FEEDBACK.md` now names the rule the
    panel session really reads, `## figma-cli Feedback` in `~/.claude/CLAUDE.md`


- [x] `loop` · **The only active trigger hangs on `/compact`, so a long session never files anything**
  **Repro:** a FigmaClaude session in `/Users/danielmartin/Website` that ran a full working day —
  built a page in Figma, hit seven distinct frictions — and never compacted
  **Observed:** nothing reached `## Open` all day. The seven entries were written only after
  another session asked whether I knew about the loop. The `## Sweep for CLI feedback` step in the
  `pre-compact` skill is the one active trigger, and it fires before a `/compact` that never came.
  **Expected:** the rule asks for filing "in the moment of the friction", so something has to fire
  at that moment rather than at an event that may not happen. A `PostToolUse` hook on `Bash` would
  do it: the command contained `figma-cli` **and** either exited non-zero or its output carried
  `✗`, `⚠` or `error:`. One latch per session so it cannot nag.
  Checking the exit code alone is not enough — five of that day's commands would have fired,
  including `render`, which **exits 0** while printing `⚠`, and that is exactly where the text
  style bug hid for a whole page. Two of the seven (silent `console.log`, missing `instantiate`)
  end at 0 with no warning, so the compact sweep still earns its place as the second net.
  **Context:** 2.1.2, `FIGMACLAUDE=1`, session in /Users/danielmartin/Website. Hook and rule both
  live in Daniel's global `~/.claude`, so both are his call, not another session's.
  → built: `bin/fig-feedback-hook`, a PostToolUse hook on Bash, installed by
    `bin/fig-feedback-setup` (step 3). Your design taken as written, output scan included — the
    ⚠ case is why. Panel sessions only, one latch per session. Proven end to end: a failing
    `figma-cli` call delivered the reminder, the next one stayed silent

- [x] `loop` · **A project's own LEARNINGS.md quietly wins over this file**
  **Repro:** same session. Every one of the seven findings was written down carefully and
  immediately — into `Site/LEARNINGS.md`, where ten lines now concern figma-cli.
  **Observed:** none of them into `FEEDBACK.md`. Not forgetting: mis-routing. The project has a
  notes file I write to every day, and the rule in `~/.claude/CLAUDE.md` does not say the two are
  not alternatives.
  **Expected:** one sentence in the text `bin/fig-feedback-setup` writes, saying a figma-cli
  friction goes here **even when** the same finding is also worth a line where you are working.
  **Context:** 2.1.2, session in /Users/danielmartin/Website
  → built: the sentence is in the text `bin/fig-feedback-setup` writes, with its own marker so an
    existing install gets it amended instead of skipped. Applied here on Daniel's decision

- [x] `loop` · **The open-entry count is off by one because it counts the format template**
  **Repro:** `grep -c '^- \[ \] ' FEEDBACK.md` on a file whose `## Open` is empty
  **Observed:** `1`. The match is line 30, the `- [ ] ` line inside the fenced Format example.
  **Expected:** an empty inbox counts 0. The `SessionStart` hook that reports how many are open
  reads the same prefix, so it will always claim one entry too many — and "1 open" on an empty
  inbox is the reading that teaches a session to ignore the number.
  **Context:** 2.1.2, FEEDBACK.md at 118 lines, `## Open` empty, seven entries in `## Done`
  → not reproducible as stated: the `SessionStart` hook counts inside `## Open` only, so it reports
    3 where `grep -c` reports 4. Line 30 is the template, and it sits before `## Open`. What was
    real: the file invited the wrong instrument, so the Format section now names the counting rule


- [x] `loop` · **The new PostToolUse reminder fired on a command that had nothing to do with figma-cli, and spent the session's one reminder doing it**
  **Repro:** `tail -14 /Users/danielmartin/Website/LEARNINGS.md` — no `figma-cli` in the command,
  exit 0, no failure. That file happens to document earlier figma-cli findings, so its contents
  carry the strings `figma-cli` and `⚠`.
  **Observed:** the reminder arrived as PostToolUse context: "That figma-cli call reported a
  failure or a warning… This is the only reminder you get in this session."
  **Expected:** the gate reads the command, not the whole payload. Matching `figma-cli` and
  `⚠`/`error:` anywhere in the payload means any command whose **output** quotes them trips it —
  `cat`, `tail`, `grep` over notes, a diff of this very file.
  The noise is the smaller half. The sharper half is the latch: one false positive **consumes**
  the single per-session reminder, so a real friction later in the same session gets nothing. A
  quiet miss is worse than a duplicate reminder, so if the two cannot be separated cleanly, the
  latch should probably count real matches rather than firings.
  **Context:** 2.1.2, `FIGMACLAUDE=1`, session in /Users/danielmartin/Website, minutes after the
  hook was installed. Same session that filed the three `loop` entries you just triaged.
  → fixed, both halves. The decision moved out of the shell into `src/lib/feedback-trigger.js`
    with 15 tests, your `tail -14 LEARNINGS.md` among them as a regression case: the command is
    parsed now, and the CLI has to BE the program rather than appear in an argument — `cat`,
    `grep`, `git diff` over notes all stay silent. Failure is read from the response only.
    The latch moved too: it is set after a real match, in `bin/fig-feedback-decide.mjs`, so a
    false positive can no longer spend it, and the message no longer claims to be the only one
    you get. Verified live: the same `grep` over this file left no reminder, a failing
    `figma-cli` call right after it delivered one
