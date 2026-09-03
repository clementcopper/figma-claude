---
name: upstream-merge
description: Take changes from silships/figma-cli into this fork. Use when picking upstream commits, when a cherry-pick conflicts, or when checking which fork-only files are at risk. Covers the branch layout (the fork's default is master, not main) and which files are ours outright.
---

# Pulling from upstream

**The fork's default branch is `master`, not `main`** — `origin/HEAD -> origin/master`. Local work
sits on `master` tracking `origin/master`; upstream's default is `main`.

`master` is the only branch the fork maintains: one trunk carrying `src/`, `app/` (Electron) and
`swift-host/`. It was `v2` until 2026-09-03 — see *The branch cleanup* at the end. The repository
is `clementcopper/figma-claude`; it was `clementcopper/figma-cli` until the same day.

**Pick, do not merge** (decided 2026-09-03). The fork is no longer a copy of upstream with a few
blocks inserted — the app is the subject and the CLI is a part of it, so a whole-tree merge drags
in text that no longer belongs here.

```bash
git fetch upstream
git log --oneline upstream/main ^master        # what is actually new over there
git cherry-pick <sha>                          # one at a time, and only what matters here
```

Conflicts to expect, and only in files upstream also touches: `CLAUDE.md` (ours), `CHANGELOG.md`
(the `## Fork` section above `## Upstream`) and possibly `package.json` (`bin`/`files` entries for
`bin/`).

`README.md` is **ours outright** since 2026-09-03 — rewritten around Figma Claude, with the CLI
credited to Sil Bormüller in the first screen. Never reconcile it with upstream's; take nothing
from there but facts worth restating in our own words.

## What must survive every pull

- `bin/fig-start`, `bin/fig-status` — fork-only launchers
- the non-destructive `connect` (`src/lib/connect-plan.js`) — offered upstream as PR #40; drop it
  here once it lands there
- `app/` — FigmaClaude. Deliberately self-contained: not installed by the root `npm install`, not
  in the npm `files` list, and nothing in `src/`, `tests/` or `package.json` refers to it, so an
  upstream merge cannot collide with it
- `docs/FIGMA-USAGE.md` — started as upstream's own `CLAUDE.md`. **Diverges on purpose since
  2026-09-01**, byte-identity dropped (below). Fork-only content so far: the
  Framelink-vs-figma-cli section at the end (Framelink is Daniel's local MCP setup, not
  upstream's concern — drop it from any PR), plus three added lines answering panel feedback —
  arc ends are always flat (Ellipse block), `<Text align=>` and its auto-FILL (Text block), and
  eval/run printing the return value (key-rules). Those three are upstream-worthy; the Framelink
  section is not

## Why byte-identity is gone (decided 2026-09-02)

The rule was: keep the guide identical so Git's rename detection applies upstream's edits by
itself. It cost a judgement call on every documentation change and was broken twice within two
days by feedback that had to be answered where the panel actually reads — `docs <topic>`.

Measured when the rule was dropped:

| | |
|---|---|
| `upstream/main` last commit | 2026-08-12 |
| our branch vs `upstream/main` | **0 behind, 76 ahead** |
| PRs open upstream | 11, incl. all four of ours since 16./17.08. |
| PR #29 (a stranger's MCP server) | open since 2026-07-07, **zero comments** |

0 behind is the number that decided it: pulling stays free, so the remote and the four PRs stay.
Only the *constraint* went. Merge from upstream whenever something lands there — expect a hunk
in the guide now, resolve it, move on. Don't restore byte-identity; re-check the numbers above
before assuming upstream is still quiet.

## Before merging

Check the four PRs sent upstream (#40 connect, #41 `docs <topic>`, #43 render fixes, #44 text
styles) — anything merged there arrives with the pull and its local copy can go.

## The branch cleanup (2026-09-03)

Seven branches became one. The measurement that decided it:

```
feat/swift-host  =  v2 + 26 commits      v2 fully contained
tree difference  =  swift-host/ only
app/ (Electron)  is in BOTH
```

The Electron app is a directory, not a branch — and `swift-host/Tools/make-app.sh` reads
`app/build/icon.icns`, so the two cannot be separated anyway. A second branch beside the trunk
would have been a copy of the same CLI falling behind; `v2` had already stood still since 22.08.

- `master` — the trunk, created from `feat/swift-host` at `795702a`. Nothing was rewritten.
- `v2-final` (`6d0eb11`) and `draft-v1` (`bef847d`) — tags, not branches. The old states are kept,
  not maintained.
- `feat/docs-topics`, `feat/text-styles`, `fix/connect-non-destructive`,
  `fix/render-fill-and-error-masking` — **still on `origin`, deliberately**. They carry the open
  PRs #41, #44, #40, #43; deleting them on origin closes those PRs. Their content is already in
  `master`. They exist nowhere locally — check one out from `origin/<name>` if a PR needs work.

Watch out: `.github/workflows/test.yml` triggers on `branches: [main]`, a branch this fork has
never had. CI has therefore never run on a push here, before or after the rename. Adding `master`
to that list would fix it and cost a small conflict on every upstream merge; left alone for now.
