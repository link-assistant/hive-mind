---
'@link-assistant/hive-mind': patch
---

Stop the session log from swallowing the pull request diff (issue #2135).

A session ended as `Work session failed (exit code: 1)` after its log reached
286 MB and the solve process died on the V8 heap limit.
`getPullRequestChangeStats` ran `gh pr diff` with command-stream's default
`mirror: true`, so the whole diff was echoed to stdout, copied into the session
log, committed to the branch by `--development-log`, and included again in the
next run's diff — each round larger than the last.

- `gh pr diff` is now read quietly and measured in a single streaming pass, with
  a warning past 8 MB; the same quiet-probe treatment is applied to every other
  unbounded-output probe, pinned by a source-scanning regression test.
- `src/contributing-guidelines.lib.mjs` no longer calls `.raw()` on a wrapped
  `gh` promise, a `TypeError` that silently disabled guideline detection.
- New `src/child-exit.lib.mjs`: a child killed by a signal is reported as such
  instead of `exited with code null`, and `hive` no longer records an
  out-of-memory worker as a success.
- New `src/log-growth.lib.mjs`: the session log warns at 64 MB / 256 MB / 1 GB,
  naming the usual cause, so a runaway log is visible before it is fatal.
- A failed development-log publication now discards the copies it wrote instead
  of leaving them untracked, where they were read as the AI's uncommitted work
  and triggered the restarts that multiplied the growth.
- `docs/case-studies/issue-2135` records the timeline, evidence and analysis.
