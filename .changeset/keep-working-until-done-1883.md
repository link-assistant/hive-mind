---
'@link-assistant/hive-mind': minor
---

feat(solve): experimental `--keep-working-until-all-requirements-are-fully-done` (#1883)

Add an experimental `solve` option that, after the main run (and any `--finalize`
pass), scans three cheap sources — the pull request description, the AI solution
summary, and the added lines of changed markdown documents — for strong
indicators of deferred work ("out of scope", "future work", "follow-up PR",
"deferred", "delayed", "TODO"/"TBD", etc.) using ~14 regular expressions. When
indicators are found it auto-restarts the AI tool with the concrete detected
reasons plus a verbatim reinforcement prompt, and repeats until the scan is clean
or the restart limit is reached.

Limit semantics:

- `--keep-working-until-all-requirements-are-fully-done` (bare) → 5 restarts
- `... 3` → an explicit count
- `... forever` / `unlimited` / `infinite` / `0` → no limit (with a hard cap of 3
  consecutive errors as a safety net)

Aliases: `--keep-going-until-all-requirements-are-fully-done`, `--keep-working`,
`--keep-going`.

Detection lives in a pure, network-free module
(`src/solve.keep-working.detect.lib.mjs`) for full unit-test coverage;
orchestration lives in `src/solve.keep-working.lib.mjs`. A deep case study is
compiled under `docs/case-studies/issue-1883/`.
