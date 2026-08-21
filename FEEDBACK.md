# Feedback from the panel

What figma-claude runs into while using this CLI from inside FigmaClaude.app, written down where
it happened. **Filing:** figma-claude, in the moment of the friction — see
`Business/.claude/rules/figma-design.md`. **Emptying:** `/feedback-triage` in a session here.

An entry is an observation, not a diagnosis. figma-claude cannot see this repo's source; what it
can see is the command it ran and what came back, and that is what belongs here.

## Format

One `- [ ] ` per entry — a `SessionStart` hook counts that prefix to say how many are open, so it
is a format rule rather than a matter of taste. Tag each with the area it concerns:

| Tag | Concerns |
|---|---|
| `cli` | a command fails, or does something other than documented |
| `docs` | `docs/FIGMA-USAGE.md` or `REFERENCE.md` is wrong or silent about something |
| `app` | friction in FigmaClaude.app itself — buttons, status, tabs, status line |
| `wish` | a command that is missing |

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
