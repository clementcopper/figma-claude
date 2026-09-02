---
name: upstream-merge
description: Pull changes from silships/figma-cli into this fork. Use when merging or rebasing on upstream, when `git merge upstream/main` conflicts, or when checking which fork-only files are at risk. Covers the branch layout (the fork's default is v2, not main) and the four files that reliably conflict.
---

# Pulling from upstream

**The fork's default branch is `v2`, not `main`** — `origin/HEAD -> origin/v2`. Local work sits
on `v2` tracking `origin/v2`; upstream's default is `main`.

```bash
git fetch upstream && git merge upstream/main
```

Expect conflicts only in `CLAUDE.md` (ours), `README.md` (two fork blocks: the note under the
header, the FigmaClaude section before *For developers*), `CHANGELOG.md` (the `## Fork` section
above `## Upstream`) and possibly `package.json` (`bin`/`files` entries for `bin/`). All fork
additions sit at the top or at a section edge, so a conflict stays local.

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
