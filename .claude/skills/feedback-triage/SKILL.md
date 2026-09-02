---
name: feedback-triage
description: Work through the panel feedback in FEEDBACK.md. Use when the session start reported open feedback entries, when the user says /feedback-triage, "triage the feedback", "arbeite das Feedback ab", or when they ask what figma-claude has reported about the CLI or the app.
---

# Triaging panel feedback

`FEEDBACK.md` is where figma-claude writes what it ran into while using this CLI from inside
FigmaClaude.app. Its author cannot see this repo's source — an entry is an observation, never a
diagnosis. Turning one into a fix, a documented behavior, or a considered "no" happens here.

A `SessionStart` hook (`.claude/settings.json`) counts the `- [ ] ` lines under `## Open` and
reports the number. That count is the only reason the format is fixed.

## Before the first entry: check what the merge left behind

The file is written from more than one machine and merged with `merge=union` (`.gitattributes`),
which resolves per line rather than per entry. Two things to look for after a merge landed:

- **the same finding twice**, reported from both machines
- **a gutted entry** — union keeps a line that both sides shared only once, so where two entries
  had an identical `**Repro:**` line, one of them now has none

Fix those first; triaging a half-entry wastes the reproduction step.

## Per entry, in this order

### 1. Reproduce it before deciding anything

Run the command the entry names, against the state it names. Not the paraphrase — the command.

Three failures are common enough to expect:

- **The report is right, the cause is elsewhere.** Panel-side reports have blamed the CLI for
  what turned out to be a stale daemon or an unbound file.
- **The report is wrong.** What looked like a bug was the documented behavior, and the real
  finding is that the docs are hard to find or hard to read.
- **The observation is real but comes from a different command than the `**Repro:**` line names.**
  A `wish` entry described `render --verify` as fixed at scale 0.5 and gave a measured image size
  as proof; the number came from `figma-cli verify`, which the reporter had run instead, and
  `render --verify` was fixed at 1. The reporter later confirmed they had never called the
  command they were writing about. So read the **Observed** number against the code path the
  **Repro** line actually reaches, and where they disagree, believe the code and say which
  command produced the number. The finding usually survives; the explanation rarely does.

If it does not reproduce, say so in the entry rather than deleting it — a second sighting turns
a non-reproduction into a pattern.

### 2. Decide where it belongs

| Finding | Goes to |
|---|---|
| Real bug | a fix in this repo, plus symptom/cause/fix in `.claude/bugs-and-fixes.md` |
| Works as designed, but surprising | one line in `LEARNINGS.md`, under the matching heading |
| Docs wrong or silent | `docs/FIGMA-USAGE.md` or `REFERENCE.md` |
| Panel, not CLI | a fix under `app/`; its tests live in `app/tests/` and run with `npm test` there |
| Upstream's, not ours | an issue at `silships/figma-cli`, link it in the entry |
| Nothing to do | `## Done` with the reason, so the next sighting is not re-triaged from zero |

A `wish` entry is a design question, not a task. It stays open until it is either built or
answered with a reason — do not quietly move it to `## Done` for being a wish.

### 3. Move it and record where it went

Cut the entry out of `## Open`, tick the box, append it to `## Done` with one `→` line naming
the destination:

```markdown
- [x] `docs` · **`docs slots` shows a syntax that no longer parses**
  → fixed in `docs/FIGMA-USAGE.md`, commit 4f2a91c
```

## What not to do

- **Do not tick a box on a plausible story.** A bug is explained when a rebuild produces the same
  message, not when the explanation sounds right.
- **Do not batch-close.** Each entry gets its own reproduction, or it stays open.
- **Do not rewrite the reporter's text.** The wording is evidence; the `→` line is your answer to
  it.
- **Do not put fix detail in `FEEDBACK.md`.** It is an inbox. `bugs-and-fixes.md` and
  `LEARNINGS.md` are where knowledge lives.

## Finishing

Run the affected tests — `npm test` in the root, and `npm test` in `app/` when the entry was an
`app` one. Then check the count the hook uses:

```bash
awk '/^## Open$/{o=1;next} /^## /{o=0} o && /^- \[ \] /{n++} END{print n+0}' FEEDBACK.md
```

Zero means the next session starts quiet. A number means entries are deliberately still open —
say which and why, rather than leaving the user to read the file.
