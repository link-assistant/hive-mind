# F6 — Two `::warning` annotations on every run (files near the line limit)

**Severity:** Medium · **Class:** Warning
**Status:** Fixed by extraction in `bcc3df08`.

## Symptom

Run 33861728465 ended with exactly two `::warning` annotations, both from
`check-file-line-limits`
([`../ci-logs/run-33861728465-checks-and-release.log`](../ci-logs/run-33861728465-checks-and-release.log.gz)
lines 14960–14995):

```
WARNING: ./src/solve.repository.lib.mjs has 1373 lines (approaching limit of 1500, warning threshold: 1350)
WARNING: ./src/telegram-bot.mjs has 1377 lines (approaching limit of 1500, warning threshold: 1350)
```

Those two are the **entire** `::warning` inventory of the run — everything else the run
printed was either output or the F4 npm warnings, which are not annotations.

## Why the threshold exists

Issue #1593 introduced the 1350-line early warning below the 1500 hard limit, because
long files make concurrent PRs conflict. Raising the bar defeats the purpose, so both
files are fixed the way issue #2175 fixed `hive.mjs`: by extraction.

## Fix

- **`src/solve.clone-errors.lib.mjs`** takes `classifyCloneError` and
  `cleanPartialClone` (1373 → 1316). Both are pure decision logic with no dependency on
  the repository-setup flow around them. They stay re-exported, so
  `tests/anonymous-clone-auth-2192.test.mjs` and
  `tests/test-issue-1957-incomplete-clone.mjs` are untouched.
- **`src/telegram-overrides-validation.lib.mjs`** takes the solve and hive override
  validation (1377 → 1307). The two blocks were near-identical copies, so one
  parameterised function removes the duplication as well as the lines. It *reports*
  instead of exiting, which is what makes it testable in-process; the caller still owns
  the messages and the exit code, and `tests/test-telegram-bot-dry-run.mjs` plus
  `tests/test-telegram-bot-configuration-isolation-links-notation.mjs` assert on those
  exact strings.

`tests/extracted-modules-2198.test.mjs` covers the extracted behaviour and, in its first
block, fails if **any** tracked file drifts back above the threshold — reading the
threshold from `scripts/check-file-line-limits.sh` so the two cannot disagree. Verified
to fail on the pre-fix state.

## Follow-on

Adding the secretlint step (F8) pushed `release.yml` itself over 1350. Rather than accept
a new warning while removing two, the memory-check job's three inline smoke-test blocks
moved to `scripts/memory-check-smoke-test.sh` (same commands, same order): 1360 → 1322.

## The guard earning its keep

While this PR was open, `main` merged issue #2186 (`5f062aa5`, "Reclaim orphaned agent
snapshot stores"), which grew `src/agent.lib.mjs` from 1309 to **1357** lines. Merging
`main` into this branch therefore reintroduced exactly the warning class this finding
removed — and the guard caught it locally, before CI, naming the file and the count:

```
AssertionError: no file exceeds the 1350-line warning threshold
  actual: [ [ 'src/agent.lib.mjs', 1357 ] ]
```

That is the difference between a threshold that is *enforced* and one that is merely
*announced*: `check-file-line-limits.sh` would have printed a `::warning` annotation and
exited 0, which is how the file drifted up in the first place.

Fixed the same way as the other three: the Agent CLI **version floors** — three
`MIN_AGENT_*` constants and the four predicates that read them — moved to
`src/agent.version-gates.lib.mjs` (1357 → 1309). They are a self-contained cluster whose
only dependency is `semver`, and every name is re-exported from `agent.lib.mjs`, so
`tests/test-codex-support.mjs` and `tests/test-issue-2186-agent-snapshot-leak.mjs` — which
import them from there — did not change and still pass.
