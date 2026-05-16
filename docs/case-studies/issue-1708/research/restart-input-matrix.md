# Restart / resume input matrix

This file enumerates every input source that today causes Hive Mind to
either restart (kill + relaunch the AI tool) or resume (`--resume <id>`)
the working session. It is the raw inventory behind R3 in
`../README.md` and is intended to stay accurate over time so future
audits of "what triggers a restart?" can start here instead of grepping.

Last updated for issue #1708 — please update when adding a new restart
trigger.

## Trigger sources

| #   | Trigger                                        | Detection site                                                                                                                                                                             | Action today                                                                                        | Streaming-mode plan                                                                                                                   |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Uncommitted changes after an iteration         | `solve.restart-shared.lib.mjs#checkForUncommittedChanges` (called from `watchUntilMergeable`, `solve.watch.lib.mjs`)                                                                       | Restart with feedback                                                                               | NDJSON frame (Claude) / batched restart (others). Cleanup of `.playwright-mcp/` happens first.                                        |
| 2   | CI failures                                    | `solve.auto-merge-helpers.lib.mjs#getMergeBlockers` → `getDetailedCIStatus` / `getWorkflowRunsForSha` / `checkCIConsensus`                                                                 | Restart with feedback (filtered to genuine code failures, not cancelled or billing-limit)           | NDJSON frame with the same `feedbackLines` payload that the restart path builds today                                                 |
| 3   | Merge conflicts / not-mergeable                | `getMergeBlockers` returns `not_mergeable` blockers whose message contains "conflicts"                                                                                                     | Restart with feedback ("resolve the merge conflicts")                                               | NDJSON frame; the bidirectional loop should also `git pull` the base branch first, mirroring `watchUntilMergeable`'s pre-restart sync |
| 4   | New non-bot comments on PR or issue            | `solve.auto-merge-helpers.lib.mjs#checkForNonBotComments` (since `lastCheckTime`); also `bidirectional-interactive.lib.mjs#fetchRecentComments` for `--accept-incomming-comments-as-input` | Restart with feedback (auto-merge loop) OR streamed NDJSON frame (bidirectional loop, when enabled) | Already streamable. The new flag just makes the streaming path the default for the auto-merge loop.                                   |
| 5   | Cancelled CI checks                            | `getMergeBlockers` returns `ci_cancelled` blocker                                                                                                                                          | `rerunWorkflowRun` re-triggers the run; AI is **not** restarted                                     | Same — no NDJSON needed                                                                                                               |
| 6   | Billing limit on CI                            | `getMergeBlockers` returns `billing_limit` blocker (matches `BILLING_LIMIT_ERROR_PATTERN`)                                                                                                 | Stop the loop, post a comment; AI is **not** restarted                                              | Same — no NDJSON needed; the streaming loop must also stop on billing limit                                                           |
| 7   | Usage / rate limit reached during an iteration | `claude.lib.mjs` / `codex.lib.mjs` / `agent.lib.mjs` / `opencode.lib.mjs` set `limitReached: true`; `restart-shared#isUsageLimitReached` reads it                                          | `auto-restart` branch waits for reset + buffer + jitter then resumes via `--resume <sessionId>`     | Same. The streaming loop must close stdin gracefully, wait, then re-attach to the resumed session. This is gap **G2** in the README.  |
| 8   | Pre-PR failure of a transient step             | `solve.pre-pr-failure-notifier.lib.mjs`                                                                                                                                                    | Notifier-only; the existing flow handles the underlying restart                                     | No streaming-mode change                                                                                                              |
| 9   | Auto-resume on rate-limit reset                | `solve.auto-continue.lib.mjs#autoContinueWhenLimitResets`                                                                                                                                  | Re-spawns `solve.mjs` with `--resume <sessionId> --working-directory <tempDir>`                     | The resumed `solve.mjs` would read `--auto-input-until-mergeable` from `argv` and re-attach the streaming pipe                        |
| 10  | New `--watch` mode iteration                   | `solve.watch.lib.mjs`                                                                                                                                                                      | Scheduled restart at `watch.intervalMs`                                                             | Out of scope for issue #1708 (watch mode is a separate cadence; can be folded in later)                                               |

## Triggers from the issue text **not** covered today

- **Issue title or issue description (body) updates during the working
  session.** The current code paths read only the comments endpoints
  (`/issues/{n}/comments` and `/pulls/{n}/comments`). Adding a
  body-and-title diff requires either polling `/issues/{n}` and
  `/pulls/{n}` and caching the last seen `body` + `title`, or using the
  `updated_at` timestamp on the issue/PR object as a cheap dirty-bit
  before doing the full fetch. Mapped to gap **G1**.
- **PR description / title updates.** Same as above for the PR object.

## Where the streaming pipe is today

Only `--tool claude` exposes a long-lived NDJSON channel via
`--input-format stream-json` + `stdin: 'pipe'`. See
`src/claude.lib.mjs:736-794`. For Codex/Agent/OpenCode the stdin pipe is
written once at process start and the upstream tool does not document a
multi-turn input channel, so the streaming-mode design degrades to
"smarter restart batching" for those tools (see Stage 4 in the README).

## Where the resume contract is today

`--resume <sessionId>` is supported by all four tools at process start
but not after process start. Even Claude's resumed sessions today are
gated against the bidirectional pipe (line 739 of `claude.lib.mjs`),
which is the source of gap **G2**.
