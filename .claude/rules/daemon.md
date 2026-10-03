# Daemon, health probe, retries

Distilled from `LEARNINGS.md` § Process and `.claude/bugs-and-fixes.md` (2026-10-03). Connection-mode rules that predate this file sit in `cli.md`.

- **A timeout is its own verdict, never a transport fault** (`'timed-out'` in `src/lib/exec-retry.js`): the script keeps running in Figma, a probe waits behind it and reads "dead", and a retry runs the script again. No probe, no `close()`, no second run after `Execution timeout`.
- **After a timeout, a silent `/health` means busy, not dead** (`timeoutMessage` in `src/lib/connection-help.js`); never name `daemon restart` inside the panel.
- **Reproduce daemon behaviour with a busy loop and a small `--timeout`, then read `daemon.log`** — `eval 'const t=Date.now(); while(Date.now()-t<12000){}; return 1' --timeout 3` showed three runs and two reconnects in one screen. It freezes the open Figma for the loop's length; say so.
- **A running eval proves the link; never probe behind it** (`probeWhileBusy`, `rendererBusy` counted on the eval, not on the request's race): `/health` answers `busy` at once, `status` names it.
- **A client timeout shorter than the server's probe reports a busy server as absent** — `HEALTH_CURL_TIMEOUT_MS` is derived from `PROBE_TIMEOUT_MS`, and `tests/health-timing.test.js` compares both ends.
- **Pipe Mode has no route around the daemon**; a silent daemon is named as busy (`directRouteAdvice`), never tried over the debug port.
