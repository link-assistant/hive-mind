---
'@link-assistant/hive-mind': minor
---

feat(solve): experimental `--escalate` mode (#1885)

Add an experimental `solve` option family that solves a task cheaply first and
escalates to a more capable (more expensive) model only while unfinished work
remains. The model ladder, cheapest → most capable, is `haiku < sonnet < opus <
fable`.

- `--escalate` (bare) → the default range `sonnet-fable`.
- `--escalate sonnet-opus` → an explicit `<lower>-<upper>` range (`-` delimits the
  bounds; only the short ladder names are allowed inside a range).
- `--escalate-from haiku` → shortcut for `--escalate haiku-fable` (aliases such as
  `opus-4-8` accepted here, since a single value is unambiguous).
- `--escalate-steps N` (default 1) → keep each tier for N working sessions before
  escalating (e.g. `2` → two sonnet sessions, then two opus, then two fable).

The first regular solve session runs on the range's lower bound (unless `--model`
is explicitly pinned). After it finishes, the escalate loop re-scans the pull
request for deferred/unfinished-work indicators — reusing the detector from issue
#1883 — and escalates to the next tier only if work remains; otherwise it stops
early so the expensive tiers are never invoked. Restarts are capped at 3
consecutive errors and stop on a usage limit. Escalate is Claude-only and runs
before `--finalize` / `--keep-working`.

Pure parsing/planning helpers live in a network-free module
(`src/solve.escalate.lib.mjs`) with full unit-test coverage
(`tests/test-escalate-1885.mjs`); a deep case study is compiled under
`docs/case-studies/issue-1885/`.
