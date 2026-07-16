# Issue #2056: auto-restart cost scope

## Summary

An auto-restart created a new Claude session, but Hive Mind's module-level
Anthropic cost accumulator still contained the preceding working session's
cost. The public estimate was scoped to the new session while the Anthropic
figure was scoped to both sessions, producing a false `$33.488057 (+3711.42%)`
difference.

The fix starts a cost scope at the `executeClaude` boundary:

- fresh execution: reset the accumulator;
- true `--resume`: preserve the accumulator, or seed it from
  `--previous-anthropic-cost` in a child process;
- fresh `--auto-restart-on-limit-reset`: do not pass the previous cost.

This keeps the issue #1886 fix for a single transcript resumed after a usage
limit, while separating independent working sessions.

## Requirements inventory

| ID  | Requirement                                                                                       | Source                                    | Resolution                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Calculate every fresh working session separately.                                                 | Issue title/body                          | `beginAnthropicCostScope` resets on executions without `--resume`.                                                                                                                                                                    |
| R2  | Verify the linked calculation precisely.                                                          | Issue body and formal-ai PR #652 comments | Both complete Gist logs were downloaded; the two result events and displayed arithmetic are reconstructed below.                                                                                                                      |
| R3  | Preserve correct behavior in all continuation modes.                                              | “correct in all cases”                    | Tests cover fresh in-process restart, same-process resume, cross-process resume, and defensive rejection of stale cost on a fresh run.                                                                                                |
| R4  | Apply the fix throughout the codebase.                                                            | Issue body                                | The lifecycle hook is in shared `executeClaude`, which is used by top-level solve, watch mode, and auto-restart-until-mergeable; fresh corrupted-transcript recovery and the separate child-process restart path were also corrected. |
| R5  | Archive all related logs and data.                                                                | Issue body                                | `raw-data/` contains both full compressed Gist logs plus issue and linked-PR API records for all three PR comment types.                                                                                                              |
| R6  | Reconstruct the timeline, root cause, alternatives, and implementation plan with online research. | Issue body                                | This case study contains each section and links the primary documentation used.                                                                                                                                                       |
| R7  | Add a reproducing automated test before the fix.                                                  | Repository workflow                       | The test first failed because `beginAnthropicCostScope` did not exist, then passed with the implementation.                                                                                                                           |
| R8  | Prepare a patch release.                                                                          | Contributing guide                        | A patch changeset accompanies the bug fix.                                                                                                                                                                                            |

## Evidence and timeline

All timestamps are UTC on 2026-07-12.

1. `20:05:53.060`: the initial Claude result for session
   `4ef88a24-7d8e-4099-8185-d99d49cf430a` reports
   `total_cost_usd = 33.48805700000002`.
2. `20:06:38`: formal-ai PR #652 receives the initial solution-log comment
   showing a rounded `$33.488057` cost.
3. `20:06:55`: watch mode announces auto-restart 1/5 for uncommitted files.
4. `20:07:13.521`: the restart creates a different session,
   `5f11451a-65a7-400e-aace-0f47a2881dcf`; it is not a resume of the first
   transcript.
5. `20:12:32.595`: the second result reports
   `total_cost_usd = 0.9022979999999999`.
6. `20:12:38.540–545`: Hive Mind correctly computes the public estimate as
   `$0.902298`, but displays Anthropic's cost as `$34.390355` and the difference
   as `$33.488057 (+3711.42%)`.

The displayed values are exact consequences of cross-session addition:

```text
33.488057 + 0.902298 = 34.390355
34.390355 - 0.902298 = 33.488057
33.488057 / 0.902298 * 100 = 3711.42%
```

Relevant full-log locations are preserved in
`raw-data/initial-working-session.log.gz` and
`raw-data/auto-restart-1.log.gz`. The latter has 72,373 lines; the decisive
records are original lines 67,396, 68,377, 72,195, 72,326–72,328.

## Root-cause analysis

Issue #1886 introduced `cumulativeAnthropicCostUSD` to reconcile two scopes
during a real resume:

- Claude Code appends resumed conversation events to one session JSONL;
- each CLI process emits its own `total_cost_usd` result;
- therefore Anthropic process costs must be added when one logical transcript
  spans a limit-reset continuation.

The accumulator was a module singleton, and its seed operation was intentionally
idempotent for the lifetime of the Node process. That lifetime is broader than
a Claude working session. Both watch mode and auto-restart-until-mergeable call
the shared executor repeatedly in one process. A fresh second call received a
new session ID and a session-only public estimate, but `addAnthropicRunCost`
added its result to the old singleton.

There was a second instance of the same scope error: the cross-process
auto-continue builder passed `--previous-anthropic-cost` for both resume and
restart modes, even though restart mode intentionally omits `--resume` and
starts a new transcript.

This is an ownership/lifecycle defect, not a floating-point or pricing defect.
The decimal arithmetic and both underlying source values were correct; the
values belonged to different scopes.

## Online research

Anthropic's official [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
distinguishes a normal invocation from `--resume <session-id>` and documents
JSON/stream-JSON output for automation. The official
[Claude Code SDK documentation](https://docs.anthropic.com/en/docs/claude-code/sdk)
documents the terminal result object containing both `session_id` and
`total_cost_usd`. These fields provide the natural accounting boundary: a new
session is independent, while an explicit resume continues a transcript.

The implementation continues to use
[decimal.js-light](https://mikemcl.github.io/decimal.js-light/) for displayed
cost comparison. No additional library is needed: the missing component was a
lifecycle operation around the existing accumulator, not new arithmetic.

## Considered solutions

1. Reset in `solve.watch.lib.mjs` only. Rejected because
   auto-restart-until-mergeable and direct/shared executor callers would retain
   the bug.
2. Reset before every Claude process. Rejected because it would regress #1886:
   a usage-limit continuation of the same transcript must accumulate process
   costs to match the transcript-wide estimate.
3. Key totals only by Node process. This is the faulty behavior.
4. Start the scope in shared `executeClaude`, based on whether `argv.resume` is
   present, and prevent a fresh child-process restart from carrying cost.
   Selected because it covers all shared callers and preserves true resumes.
5. Replace the singleton with `AsyncLocalStorage` or a map keyed by session ID.
   Not needed today because executions are sequential and a fresh session ID is
   only known after the process starts. It would add state without improving
   the current lifecycle guarantee.

## Verification

`tests/test-issue-1886-cost-accumulation.mjs` now verifies:

- the linked `33.488057 + 0.902298` reproduction resets to `$0.902298`;
- same-process `--resume` accumulation remains `$36.085015`;
- a child process can seed the carried-forward `$11.422795` and reach the same
  `$36.085015` total;
- stale carried cost is ignored defensively for a fresh execution;
- both fresh corrupted-transcript recovery paths reapply the lifecycle boundary;
- all original #1886 pricing and rendering tests still pass.

## Raw-data manifest

| File                                           | Purpose                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `initial-working-session.log.gz`               | Complete 7.2 MB initial-session Gist, compressed losslessly.      |
| `auto-restart-1.log.gz`                        | Complete 7.7 MB restart Gist, compressed losslessly.              |
| `initial-working-session-gist.json`            | Initial Gist metadata and immutable raw-content URL.              |
| `auto-restart-1-gist.json`                     | Restart Gist metadata and immutable raw-content URL.              |
| `issue-2056.json` / `issue-2056-comments.json` | Issue description and complete comment response.                  |
| `formal-ai-pr-652.json`                        | Linked PR metadata, commits, and files.                           |
| `formal-ai-pr-652-conversation.json`           | Complete linked PR conversation, including the two cost comments. |
| `formal-ai-pr-652-review-comments.json`        | Complete inline review-comment response (empty).                  |
| `formal-ai-pr-652-reviews.json`                | Complete review response (empty).                                 |

SHA-256 checksums are stored in `raw-data/SHA256SUMS`.
