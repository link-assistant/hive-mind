# Issue #2148 case study: auto-resume omitted its session boundary and result log

## Executive summary

On 2026-08-11, Hive Mind was monitoring
[link-assistant/formal-ai#997](https://github.com/link-assistant/formal-ai/pull/997) in
`--auto-restart-until-mergeable` mode. An auto-restart session hit an Anthropic usage limit at
00:45 UTC. Hive Mind correctly waited and invoked Claude with
`--resume b66c8022-e673-4f46-a6aa-0f1d21fc8848` at 02:00 UTC. The resumed agent worked for about
2 hours 26 minutes, pushed commit `ff9a9100`, and eventually left the pull request with all 52
checks passing.

The work succeeded, but its public lifecycle was incomplete. The pull request contained a usage
limit comment promising a **fresh restart**, then jumped directly to **Ready to merge** almost five
hours later. It contained no **Auto Resume (on limit reset)** boundary, no working-session summary,
and no log for the resumed execution.

This was not an Anthropic or GitHub failure. It was a Hive Mind control-flow defect in
`watchUntilMergeable()`:

1. the limit-reset continuation ran inside `src/solve.auto-merge.lib.mjs`, bypassing the normal
   `startWorkSession()` lifecycle;
2. the notice hard-coded `autoResumeMode: 'restart'`, although the next Claude command used
   `--resume` and preserved the session ID;
3. when `resumeResult.success` was true, the code captured two fields and then executed an
   unconditional `continue`;
4. that `continue` skipped the common success path that publishes the working-session summary,
   uploads the session log, re-verifies the PR-to-issue link, and tracks the session's own comments.

The fix explicitly posts the existing tracked auto-resume start comment at the in-process session
boundary and normalizes a successful `resumeResult` into the ordinary iteration result. The resumed
execution now goes through the same reporting path as every other successful iteration. Its log is
named `⏰ Auto Resume (on limit reset) N/M Log`, and the usage-limit notice accurately says that
context will be preserved.

## Preserved evidence

All evidence used for this investigation is preserved under [raw-data](raw-data/README.md). It
includes authenticated GitHub snapshots for issue #2148, this fix's initial PR state, Formal AI PR
#997 and all three comment/review channels, the PR timeline, metadata for each linked Gist, and the
three complete sanitized execution logs.

The primary trace is
[full-start-command.log.txt](raw-data/logs/full-start-command.log.txt) (196,447 lines). Important
locations are:

|           Lines | Evidence                                                                      |
| --------------: | ----------------------------------------------------------------------------- |
| 139,258–139,264 | Claude reports HTTP 429 and the 01:50 UTC reset time for session `b66c8022…`. |
| 139,345–139,352 | Hive Mind schedules auto-resume `1/5` for 02:00:26 UTC.                       |
| 139,385–139,424 | The wait ends and Hive Mind invokes `claude --resume b66c8022…`.              |
| 195,541–195,544 | The resumed execution succeeds and the PR head is `ff9a9100…`.                |
| 196,368–196,398 | All 52 checks pass and the PR is declared mergeable.                          |
| 196,404–196,405 | Hive Mind posts Ready to merge and exits the auto-restart loop.               |

The complete PR comment snapshot is
[formal-ai-pr-997-conversation-comments.json](raw-data/github/formal-ai-pr-997-conversation-comments.json).
It has exactly five comments, so the absence is directly observable rather than inferred from a
partial `gh pr view` response.

## Timeline (UTC)

| Time                | Event                                                                | Public PR state                                       |
| ------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| 2026-08-10 23:58:43 | Initial agent posts its working-session summary.                     | Summary present.                                      |
| 2026-08-10 23:59:13 | Initial Solution Draft Log is posted.                                | Initial log present.                                  |
| 2026-08-11 00:44:53 | Auto-restart `1/5` starts because CI is failing.                     | Restart boundary present.                             |
| 2026-08-11 00:45:06 | Claude returns HTTP 429 for session `b66c8022…`; reset is 01:50 UTC. | No comment yet.                                       |
| 2026-08-11 00:45:35 | Usage Limit Reached comment is posted with the 13.6 MB Gist.         | Incorrectly promises a fresh restart.                 |
| 2026-08-11 02:00:26 | Scheduled reset + buffer + jitter time arrives.                      | No auto-resume boundary is posted.                    |
| 2026-08-11 02:00:54 | Claude is actually invoked with `--resume b66c8022…`.                | Context is preserved despite the comment.             |
| 2026-08-11 04:26:47 | Resumed agent finishes successfully after changing Formal AI.        | No summary or resumed-session log is posted.          |
| 2026-08-11 05:41:05 | All 52 checks are green; Ready to merge comment is posted.           | Usage-limit comment jumps directly to Ready to merge. |
| 2026-08-11 05:41:13 | Outer solve command exits 0.                                         | Lifecycle remains incomplete.                         |

Relevant public comments:

- [Working session summary](https://github.com/link-assistant/formal-ai/pull/997#issuecomment-5247408844)
- [Initial Solution Draft Log](https://github.com/link-assistant/formal-ai/pull/997#issuecomment-5247411832)
- [Auto-restart 1/5](https://github.com/link-assistant/formal-ai/pull/997#issuecomment-5247737304)
- [Usage Limit Reached](https://github.com/link-assistant/formal-ai/pull/997#issuecomment-5247741687)
- [Ready to merge](https://github.com/link-assistant/formal-ai/pull/997#issuecomment-5249414107)

There is no comment between the last two entries. The review-comment and review snapshots are both
empty, so the missing lifecycle event was not posted through another GitHub comment channel.

## Requirements extracted from issue #2148

| #   | Requirement                                                                        | Resolution                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Preserve every related log and data artifact under `docs/case-studies/issue-2148`. | GitHub snapshots, Gist metadata, three full logs, provenance, and SHA-256 checksums are included.                                                          |
| R2  | Explain why no session log appeared after auto-resume.                             | The successful resume ended at an unconditional `continue` before shared reporting.                                                                        |
| R3  | Explain why no auto-resume comment appeared.                                       | The in-process continuation bypassed `startWorkSession()` and never posted its own boundary.                                                               |
| R4  | Reconstruct the full event timeline.                                               | See the UTC timeline above and preserved trace line references.                                                                                            |
| R5  | List all requirements, root causes, and solution options/plans.                    | Covered in this document.                                                                                                                                  |
| R6  | Research applicable online documentation.                                          | Anthropic and GitHub primary documentation is reviewed below.                                                                                              |
| R7  | Reuse existing components/libraries where possible.                                | The fix reuses `SESSION_TYPES.AUTO_RESUME`, the centralized marker, `postTrackedComment()`, and the existing shared reporting branch.                      |
| R8  | Add diagnostics if existing evidence cannot establish the cause.                   | Existing verbose output was sufficient; no speculative always-on logging was necessary. The repaired path already logs its posted marker and uploaded log. |
| R9  | Add a reproducing automated test before the fix.                                   | `tests/test-issue-2148-auto-resume-reporting.mjs` failed against the original source, then passed after the fix.                                           |
| R10 | Apply the correction everywhere the defective behavior occurs.                     | Repository-wide search found one in-process usage-limit handler; top-level child-process resume already uses the normal session lifecycle.                 |
| R11 | Report upstream issues when the defect belongs to another repository.              | Not applicable: both external systems behaved as documented; the defect is local to Hive Mind.                                                             |

## Root-cause analysis

### 1. Two different limit-reset architectures had drifted

The ordinary limit-reset path in `src/solve.auto-continue.lib.mjs` starts a new `solve` child process
with session type `auto-resume` or `auto-restart`. That child enters the normal work-session
lifecycle, where `startWorkSession()` can publish the appropriate boundary.

`watchUntilMergeable()` has a second, specialized path. It waits in the current Node process and
calls `executeToolIteration()` directly. That is useful because it preserves the surrounding
auto-merge watcher, but it also bypasses `startWorkSession()`. The existing reusable
`SESSION_TYPES.AUTO_RESUME` definition and `AUTO_RESUME_ON_LIMIT_RESET_MARKER` were therefore never
reached by this path.

### 2. The user-facing mode contradicted the actual command

At the pre-fix commit, the usage-limit upload passed `autoResumeMode: 'restart'`:

- [pre-fix lines 939–944](https://github.com/link-assistant/hive-mind/blob/80e537852ed90a67890b1fb247e520387ff48946/src/solve.auto-merge.lib.mjs#L939-L944)

The same function then built `resumeArgv` with the old session ID and invoked the tool:

- [pre-fix lines 970–985](https://github.com/link-assistant/hive-mind/blob/80e537852ed90a67890b1fb247e520387ff48946/src/solve.auto-merge.lib.mjs#L970-L985)

This is why the PR promised a fresh start while the trace proved that context was preserved.

### 3. A successful resume was not normalized into the iteration result

The first tool result was declared as a constant and remained a failed, limit-reached result. The
successful `resumeResult` was a block-local value. The success branch only copied session ID and
cost, after which execution reached this unconditional control transfer:

- [pre-fix lines 987–1,048](https://github.com/link-assistant/hive-mind/blob/80e537852ed90a67890b1fb247e520387ff48946/src/solve.auto-merge.lib.mjs#L987-L1048)

The shared successful-iteration branch begins later. It calculates budget data, invokes
`maybeAttachWorkingSessionSummary()`, invokes `attachLogToGitHub()`, verifies the PR issue link, and
then tracks comments. The early `continue` bypassed all of it.

### 4. Existing tests encoded the shortcut instead of the lifecycle

The issue-1356 simulation asserted that the loop should `continue` after a resume. The issue-1570
fixture asserted that `autoResumeMode` should be `restart`. Those tests covered limit detection,
waiting, and command construction, but not the observable session lifecycle after a successful
resume. As a result, the precise defect was both untested and partly reinforced by the fixtures.

## External documentation and component research

- Anthropic's [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
  defines `--resume <session-id>` as resuming a specific session. This supports treating the
  continuation as `AUTO_RESUME`, not `AUTO_RESTART`.
- GitHub's [issue comment REST documentation](https://docs.github.com/en/rest/issues/comments)
  confirms that pull requests use the issue-comment endpoint for shared comments. Hive Mind's
  centralized `postTrackedComment()` already uses that endpoint, so no new GitHub integration was
  required.
- The GitHub CLI [gist view documentation](https://cli.github.com/manual/gh_gist_view) documents
  `--raw`, which was used with authenticated `gh gist view` to preserve the exact linked logs.

Existing Hive Mind components selected for reuse:

| Component                               | Existing responsibility                                                     | Use in this fix                                                    |
| --------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `SESSION_TYPES.AUTO_RESUME`             | Distinguishes context-preserving limit reset from a fresh restart.          | Passed by the in-process resume path.                              |
| `AUTO_RESUME_ON_LIMIT_RESET_MARKER`     | Centralized, filterable comment/log marker.                                 | Used for the start comment and resumed log title.                  |
| `postTrackedComment()`                  | Sanitizes, posts, and records tool-owned GitHub comments.                   | Retained behind an extracted session helper.                       |
| `maybeAttachWorkingSessionSummary()`    | Publishes an AI summary only when appropriate.                              | Reached through the common success path.                           |
| `attachLogToGitHub()`                   | Sanitizes and publishes large logs/Gists.                                   | Reached through the common success path with an auto-resume title. |
| `ensurePullRequestIssueLink()`          | Repairs a PR body clobbered during an iteration.                            | No longer skipped after a resume.                                  |
| `trackAuthenticatedUserCommentsSince()` | Prevents the next cycle from treating the agent's own comments as feedback. | No longer skipped after a resume.                                  |

## Solutions considered

### Chosen: normalize the resumed result and reuse common reporting

`toolResult` is now replaceable. If `resumeResult.success`, the resumed result becomes
`toolResult`; execution leaves the failure handler and enters the existing success branch. This
has two important properties:

1. all current lifecycle work runs in its established order (summary before log, then link check
   and comment tracking);
2. future additions to successful-iteration reporting automatically apply to limit-reset resumes.

The path records `resumedAfterUsageLimit` only to select the truthful log title. Failed resumes and
immediate repeated limits keep their existing stop/retry behavior.

### Chosen: extract only the reusable start-comment boundary

`postWorkSessionStartComment()` was extracted from `startWorkSession()`. The normal top-level
function still owns draft-state transitions and its existing gating. The specialized in-process
path can now publish the same tracked comment without pretending to begin a new outer session or
performing a redundant PR state transition.

### Rejected: duplicate the summary/log code in the resume branch

This would fix the immediate symptom but create a third copy of reporting policy. Ordering,
budget-stat behavior, link verification, error reporting, and future changes could drift again.

### Rejected: spawn a new solve process from the auto-merge watcher

The top-level limit-reset architecture already does this, but replacing the watcher-specific
in-process resume would enlarge the behavioral change, complicate transfer of watcher state and
budgets, and discard a working context-preserving execution mechanism. The trace proves the resume
itself worked; only lifecycle reporting was missing.

## Implemented behavior

After the fix, the reported sequence for a successful watcher-internal limit reset is:

```text
Usage Limit Reached
  -> wait until reset + configured buffer/jitter
  -> Auto Resume (on limit reset) start comment
  -> execute Claude with --resume <same-session-id>
  -> Working session summary (when auto-summary policy allows)
  -> Auto Resume (on limit reset) N/M Log
  -> verify PR issue link
  -> track session-owned comments
  -> return to mergeability checks
```

The start marker is tracked, so it cannot suppress the auto-generated working-session summary by
being mistaken for an agent-authored comment.

## Reproduction and regression coverage

The minimal regression test is
[`tests/test-issue-2148-auto-resume-reporting.mjs`](../../../tests/test-issue-2148-auto-resume-reporting.mjs).
Before implementation it failed first on the stale `autoResumeMode: 'restart'` assertion and would
also have failed on the absent session-boundary call and absent result normalization.

It verifies that:

- the usage-limit comment advertises `resume`;
- the watcher posts a tracked work-session start comment with `SESSION_TYPES.AUTO_RESUME`;
- the initial result can be replaced by `resumeResult`;
- the shared success flow still contains summary publication, log upload, and PR issue-link
  verification; and
- the uploaded log title identifies the limit-reset resume.

The existing issue-1570 fixture is updated to match the real `--resume` semantics. The issue-1356
coverage continues to verify usage-limit detection and session-ID propagation.

## Diagnostics

No new opt-in trace mode was needed because the existing `--verbose` log established every causal
fact: the 429 result, session ID, calculated wait, exact resumed command, successful result, commit
SHA, CI outcome, and final comment list. The repaired lifecycle uses existing logs that make future
verification explicit:

```text
💬 Posted: Auto Resume (on limit reset) comment (id=...)
✅ CLAUDE resume completed: Checking if PR is now mergeable...
📎 Uploading session log...
✅ Session log uploaded to PR
🔗 Verifying PR issue link after iteration...
```

## Third-party repositories

No upstream issue was filed:

- Anthropic returned the reset time and resumed the requested session ID successfully.
- GitHub accepted the usage-limit and ready comments, hosted the Gist, and returned the complete
  PR timeline/comment data.
- The missing events resulted solely from Hive Mind's branch structure and mislabeled argument.

## Follow-up plan

The implemented regression covers the reported path. A broader future refactor could represent
every tool execution with a single lifecycle object (start boundary, result, report, end boundary)
instead of letting orchestration loops call the tool directly. That is intentionally not required
for this bug fix: normalizing the result into the existing success branch removes the observed
divergence with a small, reviewable behavioral change.
