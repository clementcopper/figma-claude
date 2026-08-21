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
- `docs/FIGMA-USAGE.md` — upstream's own `CLAUDE.md`, moved byte-identical. Keep it that way:
  rename detection then applies upstream's edits automatically instead of conflicting

## Before merging

Check the four PRs sent upstream (#40 connect, #41 `docs <topic>`, #43 render fixes, #44 text
styles) — anything merged there arrives with the pull and its local copy can go.
