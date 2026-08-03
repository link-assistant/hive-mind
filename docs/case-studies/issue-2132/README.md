# Issue 2132: context/cost budget stats must never go to the working session summary

## Executive summary

For every working session, Hive Mind published the identical
`### 💰 **Cost estimation:**` and `### 📊 **Context and tokens usage:**` blocks
twice, in two consecutive comments posted 21 seconds apart:

- the automated `Working session summary`
  ([formal-ai#915 comment 5168890917](https://github.com/link-assistant/formal-ai/pull/915#issuecomment-5168890917)),
- the `🤖 Solution Draft Log`
  ([formal-ai#915 comment 5168894369](https://github.com/link-assistant/formal-ai/pull/915#issuecomment-5168894369)).

The duplication was introduced deliberately by
[`3cfd6c22` — `fix(2115): show usage in working session summaries`](https://github.com/link-assistant/hive-mind/commit/3cfd6c22a2eeb8fee8ebb153efc28bde6d5212fe),
which read issue #2115 as "summaries lack usage facts, add them" instead of
"this session published usage facts nowhere". Issue #2132 records that reading as
a miscommunication and states the intended contract:

> Context/cost budget stats should go only in solution/working session log when
> `--attach-logs` are enabled. […] Working session summary should never be
> related to logs or context/cost budget stats.

A second, latent defect followed from the same commit: because the summary is
posted regardless of `--attach-logs`, budget statistics could reach GitHub even
when log attachment was disabled — the exact opposite of what `--attach-logs`
promises.

## Requirements inventory

Every requirement stated in the issue body, with its resolution in this pull request.

| #   | Requirement (issue #2132)                                                                         | Resolution                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Context/cost budget stats go **only** in the solution / working session log                       | `attachSolutionSummary()` no longer renders cost or budget blocks; `buildWorkingSessionSummaryDetails()` is now a documented empty-string invariant |
| 2   | The working session summary must never be related to logs or budget stats                         | The summary body is now only the AI's own text plus the #2119 "no changes" notice                                                                   |
| 3   | Stop the per-session duplication seen in the linked comments                                      | Only `attachLogToGitHub()` renders `buildBudgetStatsString()`; asserted by test                                                                     |
| 4   | Double-check the same mistake is not repeated anywhere else in the codebase                       | Codebase sweep below; a test pins the single remaining renderer                                                                                     |
| 5   | Deduplicate the logic shared by the solution log and auto-restart/resume logs                     | `solve.watch.lib.mjs` and `solve.auto-merge.lib.mjs` now call the shared `buildSessionBudgetStatsData()` instead of re-implementing it              |
| 6   | Each working session must keep its own logs and budget stats                                      | Preserved: each iteration still builds its own stats from its own `sessionId` and attaches its own log comment                                      |
| 7   | Disabled `--attach-logs` must also disable context/cost budget stats                              | New `src/budget-stats-policy.lib.mjs`; `buildSessionBudgetStatsData()` returns `null` unless `--tokens-budget-stats` **and** `--attach-logs`        |
| 8   | Download and compile all related data into `docs/case-studies/issue-2132`                         | `raw/` (this directory) with checksums below                                                                                                        |
| 9   | Deep analysis: timeline, requirement list, root causes, solution plans, existing-component review | This document                                                                                                                                       |
| 10  | Add debug output / verbose mode if evidence is insufficient                                       | Root cause was fully determined from the archived comments and `git log -S`; a verbose line was still added stating **why** stats were skipped      |
| 11  | Report defects to other projects where applicable                                                 | Not applicable: no dependency is involved. The defect is entirely in this repository's publication routing                                          |

## Evidence archive

`raw/` holds the unedited GitHub API responses.

```text
88b1426f6c7f5ba19ed357009716a5890b184d65aeb37b97c755639006280910  formal-ai-pr-915-conversation-comments.json
24f8d962a9edf628b8313ab560b2811930320122513d8e9012c9726ce1ba3ed8  formal-ai-pr-915-solution-draft-log-comment.json
a9977e2cf6e6f520225d20a3a6984c931ba18462048ba5426ea9b36a0fe1dfac  formal-ai-pr-915-working-session-summary-comment.json
a257acf58ecf2aeb685d810ccb483aba837bb92680124b09a452809cc2043504  formal-ai-pr-915.json
4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945  issue-2132-comments.json
e7f13f314b920ecc7a32b57a730945523c486817903f64775fda25e29ed224bc  issue-2132.json
```

`issue-2132-comments.json` is the empty array `[]`: the issue carried no comments
when this analysis was performed, so the issue body is the complete requirement source.

## Timeline

All timestamps UTC.

| Time                | Event                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 2026-07-30 06:39:37 | Issue #2115 reports that a session's usage facts were visible nowhere                                              |
| 2026-07-30 07:22:22 | Commit `3cfd6c22` "fix(2115): show usage in working session summaries" adds cost + budget blocks to the summary    |
| 2026-08-03 16:14:01 | formal-ai PR #915 receives a `Working session summary` containing `Cost estimation` and `Context and tokens usage` |
| 2026-08-03 16:14:22 | 21 seconds later the `Solution Draft Log` comment repeats the same two blocks verbatim                             |
| 2026-08-03 16:19:22 | Issue #2132 is filed: the summary must never carry these facts, and `--attach-logs` must gate them                 |

The two archived comment bodies are byte-identical in their usage sections:
`$18.341942` total, `Claude Fable 5` with 3 sub-sessions, `Claude Opus 5`,
`Claude Haiku 4.5` — rendered twice because both call sites invoked the same
renderers (`buildCostInfoString`, `buildBudgetStatsString`) with the same data.

## Root causes

**RC-1 — Requirement inversion in the #2115 fix.** Issue #2115's session published
usage in _neither_ comment, because the summary and log publication paths received
different data. Two repairs were possible: (a) route the observed usage to the log
comment, or (b) additionally render it in the summary. `3cfd6c22` chose (b), which
fixed the visibility symptom while creating permanent duplication for every session
where the log comment worked correctly — i.e. every normal session.

**RC-2 — No single owner of the "where may usage be published" decision.** The
gate `argv.tokensBudgetStats && sessionId && tempDir` was written out three times
(`solve.results.lib.mjs`, `solve.watch.lib.mjs`, `solve.auto-merge.lib.mjs`).
With the policy scattered, adding a fourth consumer (the summary) required no
change to any gate, so nothing in the code pushed back on the new call site.

**RC-3 — `--attach-logs` was enforced at the wrong layer.** The flag was checked
only immediately before `attachLogToGitHub()`. The _derivation_ of budget data was
gated by `--tokens-budget-stats` alone. So any consumer that was not the log comment
— the summary being the first — could publish log-scoped data with `--attach-logs`
off. The flag documents itself as controlling upload of the session's execution
data to the PR; token/context/cost telemetry is exactly that.

## Codebase sweep (requirement 4)

`grep` for the renderers across `src/` after the fix:

- `buildBudgetStatsString(` — one caller: `src/github.lib.mjs` (`attachLogToGitHub`).
- `buildCostInfoString(` — same single caller (four log-comment templates inside it).
- No other module emits `💰` or `📊 **Context` into a GitHub comment body; the
  remaining `💰` occurrences are terminal `log()` output in `claude.budget-stats.lib.mjs`.

`tests/test-issue-2132-budget-stats-placement.mjs` asserts this list, so a future
call site cannot re-introduce the duplication silently.

## Deduplication (requirement 5)

Before, three copies of the same 12-line block existed. Now
`buildSessionBudgetStatsData({ argv, sessionId, tempDir, resultModelUsage,
streamTokenUsage, subAgentCalls, pricingInfo })` is the only implementation, used by:

- the top-level run (`src/solve.mjs` → `maybeAttachWorkingSessionSummary` / `verifyResults`),
- watch and temporary auto-restart iterations (`src/solve.watch.lib.mjs`),
- auto-restart-until-mergeable iterations (`src/solve.auto-merge.lib.mjs`).

Each still passes its **own** `sessionId`, so requirement 6 ("each working session
must have its own logs and budget stats") is preserved — the sharing is of logic,
not of data.

## Existing components considered

- **In-repo renderers** — `src/github-cost-info.lib.mjs` and
  `src/claude.budget-stats.lib.mjs` already format both blocks correctly, and the
  incident is not about formatting. They were left untouched; only routing changed.
- **A generic feature-flag library** (e.g. `unleash`, `flipt`) — rejected: the
  policy is two boolean CLI flags whose combination fits in one 30-line module with
  no runtime dependency, and adding a service dependency to a CLI publication path
  would be strictly worse.
- **Structured telemetry exporters** (OpenTelemetry metrics) — considered for a
  future "usage goes to telemetry, not comments" direction; out of scope here,
  because the issue asks for the data to stay in the log comment.

## Verification

- `tests/test-issue-2132-budget-stats-placement.mjs` — new: policy truth table,
  `buildSessionBudgetStatsData()` returning `null` without `--attach-logs`, empty
  summary details, single renderer, no re-implemented gates.
- `tests/test-issue-2115-working-session-summary-usage.mjs` — rewritten: keeps the
  #2115 scenario (511,606 input / 23,370,240 cache-read / 63,787 output tokens) but
  now asserts those facts render in the log comment path and **not** in the summary.
- `tests/test-working-session-summary-2119.mjs` and
  `tests/test-auto-restart-budget-2119.mjs` — unchanged and still passing, so the
  #2119 guarantees (workspace-path redaction, "nothing was implemented" notice,
  one budget block per auto-restart iteration) are intact.

## Follow-up note

`tests/test-solution-summary.mjs` is marked `@hive-mind-test-suite needs-triage`
and already fails on `main` before this change (`checkForAiCreatedComments should
be imported` — the symbol is no longer imported by name in `src/solve.mjs`). It is
outside the default suite, unrelated to this issue, and was left as-is rather than
silently folded into this pull request.

The full default suite (373 files) passes locally with these changes.
