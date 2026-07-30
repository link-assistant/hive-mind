# Issue 2115: missing usage facts in working-session summaries

## Executive summary

The automated `Working session summary` comment copied only the AI tool's final
text. Cost and token/context-budget facts were calculated later and supplied
only to `attachLogToGitHub()`. Consequently, a reviewer reading the short
summary could not see usage, even though the adjacent `Solution Draft Log`
comment could show it.

The incident is especially clear because the referenced second session emitted
a Codex `turn.completed` event and Hive Mind parsed 511,606 input, 23,370,240
cache-read, and 63,787 output tokens. Its summary omitted all of them; its log
comment also lacked cost and budget sections because that iteration's summary
and log publication paths received different data.

The fix builds the budget data before top-level publication, reuses the existing
cost and budget renderers, and passes the same facts into summaries from the
top-level, watch, and auto-restart-until-mergeable paths.

## Requirements inventory

| Requirement                                     | Evidence                                      | Resolution                                                         |
| ----------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| Show cost in working-session summaries          | Issue title and linked comment                | Reuse `buildCostInfoString()` in the summary                       |
| Show token/context budget                       | Issue title; Codex usage in the preserved log | Reuse `buildBudgetStatsString()`                                   |
| Apply the fix everywhere                        | Issue body                                    | Updated top-level, watch, and auto-merge iteration call sites      |
| Preserve all incident evidence                  | Issue body                                    | Archived issue, comments, reviews, and complete compressed log     |
| Reconstruct timeline and root causes            | Issue body                                    | Included below                                                     |
| Research existing components and external facts | Issue body                                    | Reused project renderers; primary-source findings documented below |
| Add diagnostics if evidence is insufficient     | Conditional requirement                       | Not needed: captured values and source ordering identify the cause |
| Report dependency defects upstream              | Conditional requirement                       | Not applicable: no dependency causes the publication data-flow gap |

## Evidence archive

`raw/` contains the unedited GitHub API responses and complete session log.
The 6,859,578-byte, 26,012-line log is compressed losslessly.

```text
4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945  issue-2115-comments.json
3ae34552ccc759d264cff2fc938910ca37931001946ec9952cbb797f731d796c  issue-2115.json
1704b57f8dcbd0a92be42e3a8d78cfb718820eb730782665988699cc208e1608  pr-2114-conversation-comments.json
4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945  pr-2114-review-comments.json
4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945  pr-2114-reviews.json
43a1a6402847813e20710da33061ed8e5578583b034bc68073180fd698a59b07  pr-2114-trigger-comment.json
9d9ac2aa80ac82e2c5d591150da6f440a68e96e4a4652be82f06134a3d5bf4c0  solution-draft-session.log.gz
```

## Timeline

All timestamps are UTC.

| Time                | Event                                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| 2026-07-28 20:37:11 | Follow-up working session for PR 2114 starts                                    |
| 2026-07-28 21:54:07 | Codex emits `turn.completed` with usage                                         |
| 2026-07-28 21:54:08 | Hive Mind parses 511,606 input, 23,370,240 cache-read, and 63,787 output tokens |
| 2026-07-28 21:57:28 | `Working session summary` is posted without cost or budget facts                |
| 2026-07-28 21:57:28 | `Solution Draft Log` is posted with model information only                      |
| 2026-07-30 06:39:37 | Issue 2115 reports the missing display                                          |

## Root-cause analysis

This was a presentation data-flow defect, not missing source telemetry.
`maybeAttachWorkingSessionSummary()` accepted only the final text and repository
coordinates. In the top-level flow it ran before `verifyResults()`, where budget
data was first calculated. Watch and auto-merge iterations calculated budget
data before their summary, but passed it only to the subsequent log upload.

Thus four independent facts agree:

1. Codex emitted usage.
2. Hive Mind parsed usage.
3. Existing formatters could render usage.
4. No usage fields crossed the summary function boundary.

The duplicated calculations also risked the summary and log disagreeing.
Precomputing once in the top-level flow and passing the already-built object to
verification removes that divergence.

## Existing components and alternatives

- `buildCostInfoString()` is the established renderer for public/provider cost.
- `buildBudgetStatsString()` is the established renderer for context fill,
  cumulative token categories, output budget, and cost.
- `calculateSessionTokens()` and `buildAgentBudgetStats()` already normalize
  Claude/Codex and Agent CLI observations.
- Parsing numbers out of the rendered log comment was rejected: it would couple
  two publications through Markdown and fail when log attachment is disabled.
- Asking the AI to repeat usage in its final prose was rejected: the tool's
  final message is not the authoritative telemetry source.

## External research

- GitHub documents that pull-request conversation comments use the issue
  comments API and accept a Markdown `body`. The current tracked-comment
  publication mechanism is therefore appropriate; no new GitHub integration is
  needed: <https://docs.github.com/en/rest/issues/comments>.
- The Codex SDK documents `turn.completed` usage, and Codex's app-server
  documentation describes separate token-usage events. This supports treating
  tool telemetry—not generated prose—as the source of truth:
  <https://github.com/openai/codex/blob/main/sdk/typescript/README.md> and
  <https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md>.
- OpenAI's usage API distinguishes input, cached input, and output fields,
  matching Hive Mind's existing category-aware renderer:
  <https://platform.openai.com/docs/api-reference/usage>.

## Verification

`tests/test-issue-2115-working-session-summary-usage.mjs` reproduces the missing
summary metadata and verifies cost, context fill, cached input, and output
budget rendering. Source integration passes the same data through all three
working-session modes while preserving empty summaries when no usage was
observed.
