## Problem

`--on-kill-resume <N>` (0.35.0, #176) restarts a killed detached Docker execution right after the watcher sees it end. When one host-wide out-of-memory event kills several executions at once (several containers on the same host, each capped at a share of host RAM), every watcher resumes its container in the same second. All recoveries then rebuild their working sets at once — compilers, test runners, language servers — and can trigger the next OOM event immediately.

This was raised for hive-mind in link-assistant/hive-mind#2498 ([owner feedback](https://github.com/link-assistant/hive-mind/pull/2499)): "on recovery from out of memory … we don't do it all at the same time and have some random interval from 30 to 90 seconds". hive-mind now waits a random 30–90 s before each of its own recoveries (`--session-kill-resume-delay`, default `30-90`, `0` disables), but executions that rely on `$ --on-kill-resume` have no equivalent.

## Proposal

- Add `--on-kill-resume-delay <min[-max]>` (seconds). Before each recovery attempt the watcher waits a uniformly random delay in that range. A single number means a fixed delay, `0` means no delay.
- Print the chosen delay in the `[Recovery k/N]` line and store it in `recoveryHistory` (e.g. `delayMs`), so a post-mortem can see that recoveries were spread out.
- `--stop` during the wait cancels the pending recovery, as it already does for later attempts.

A default of `0` keeps the current behaviour. Callers that run many executions on one host can opt in with e.g. `30-90`.

## Environment

start-command 0.35.1 (JS), Docker isolation, detached mode.
