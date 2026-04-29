---
'@link-assistant/hive-mind': patch
---

fix(solve): post a Working session summary at the end of every working session — issue #1728.

`--auto-attach-solution-summary` previously only ran in `solve.mjs`'s top-level flow.
Iterations inside `--auto-restart-until-mergeable` (`src/solve.auto-merge.lib.mjs`) and
`--watch` / temporary auto-restart (`src/solve.watch.lib.mjs`) called
`executeToolIteration()`, uploaded a log comment, and discarded the AI's
`toolResult.resultSummary` — so when the AI finished an iteration without posting
a comment, the user saw only the start (`Auto-restart triggered`) and end
(`Auto-restart-until-mergeable Log`) brackets with no AI conclusions in between.
Reproduced live on link-foundation/box PR #83 between comment ids
[`4345164478`](https://github.com/link-foundation/box/pull/83#issuecomment-4345164478)
and [`4345439482`](https://github.com/link-foundation/box/pull/83#issuecomment-4345439482).

Fix: extracted the attach-decision into a single helper
`maybeAttachWorkingSessionSummary` in `src/solve.results.lib.mjs` that all three
working-session call sites (`solve.mjs`, `solve.auto-merge.lib.mjs`,
`solve.watch.lib.mjs`) invoke with their own `iterationStartTime`. Each successful
iteration now ends with either an AI-authored comment OR an automated
"Working session summary" comment.

Also renamed the comment header from "Solution summary" to "Working session
summary" because not every working session is a solution draft — many are
continuation/restart iterations. CLI flag names (`--attach-solution-summary`,
`--auto-attach-solution-summary`, `--no-auto-attach-solution-summary`) and
function names are preserved for backwards compatibility. The new header is
registered in `TOOL_GENERATED_COMMENT_MARKERS` so a previous iteration's summary
is excluded from the next iteration's "did the AI post anything?" check.

Tests: extended `tests/test-solution-summary.mjs` to cover the new helper, the
header rename, the marker registration, and the per-iteration wiring in
`solve.auto-merge.lib.mjs` / `solve.watch.lib.mjs`.

Case study: `docs/case-studies/issue-1728/`.
