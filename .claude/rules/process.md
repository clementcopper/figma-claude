# Process for this repo (loads every session)

Distilled from `LEARNINGS.md` § Process and § Fork Decisions. `npm install` first, the pure-decision convention and the fork layout are in `CLAUDE.md`; merging lives in the `upstream-merge` skill.

- **The reporter's observation is evidence, the reporter's cause is a guess.** All three code bugs of the first panel-feedback round had a different cause than proposed; reproduce the command, never the diagnosis, and hold the **Observed** number against the code path the **Repro** line actually reaches.
- **Reproduce before recording a bug.** A five-minute matrix moved the `render` note from "`<Rectangle>`" to `w="fill"` to the real `catch` bug one layer down; a symptom written as a cause misleads every later session.
- **Grep the repo for the outlier before designing a fix;** the one place that differs from four others is usually the bug and the majority spells out the fix.
- **Numbers beat screenshots for layout bugs;** "auto-layout behaves weirdly" is a node-tree diff task.
- **Where two ends must form the same path, a test compares both strings.** `Figma Claude/` vs `FigmaClaude/` lived in four places, one of them a constant nobody used, and a panel handoff would have been written and never read.
- **A doc reference must name the difference, not the size, and sit where the reader stumbles over it.** Panel sessions read `docs <topic>`, `jsx-syntax`, `critical-pitfalls` and `--help`, never `REFERENCE.md` or `quick-reference`; ask where the reader actually passes.
- **Framelink MCP is anchored, not vendored** (2026-09-02): division of labour in `skills/figma-cli/SKILL.md` and the rule `bin/fig-feedback-setup` writes to `~/.claude/CLAUDE.md`; the server is registered at user scope so the key sits in `~/.claude.json` once.
- **A `.gitignore` pattern without a leading slash reaches into subdirectories, case-insensitively on macOS.** `screenshot.png` swallowed `swift-host/Screenshot.png` in silence; anchor it (`/screenshot.png`) and `git check-ignore -v` anything a document links to.
- **Cache dependencies, never build products.** Content-keyed caches holding absolute paths hit after a repo rename and broke every compile.
- **Verify an agent's finding against the code before it enters a plan;** of ~60 review findings one was wrong (`fontWeight`) and would have removed a working check. A fix is done when its test was seen red.
- **After a fix series, ask the running panel session to test with concrete commands** (SendMessage, command + output, filed in FEEDBACK.md); six findings in forty calls after a green suite of 923.
- **A convention lands only where the guard can see it;** the exit-code guard knew one spelling of ✗ and missed the template literal and the `{ ok: false }` line for a day. Widen the test first and let it list the sites.
