# Issue 2117 case study: merged pull request reported as failed

## Executive summary

The report is a real contradictory-outcome case, not evidence that the implementation failed. The preserved session log proves that the Codex task completed, tests and CI passed, the solution draft was made ready, and Hive Mind entered its auto-merge flow. GitHub independently records `link-foundation/use-m#69` as merged at `2026-07-30T06:38:12Z`. The Telegram completion message nevertheless reported runner exit code 1 roughly 44 seconds later.

The exact statement that threw after the merge cannot be reconstructed from the available artifact. The attached log is a snapshot uploaded at `06:35:36Z`, before both the merge and the outer process termination; it has no final start-command footer, exception, container inspection, or terminal status payload. Treating a specific post-merge component as the root cause would therefore be speculation.

The confirmed product defect is the status model: the notification collapsed two independent facts—goal completion and runner health—into one red “work session failed” headline. The fix preserves the nonzero exit for investigation, verifies the resolved pull request through GitHub, and reports the split outcome explicitly:

> ⚠️ Pull request merged, but the work session exited with code: 1

The Docker container remains subject to the existing failure retention policy.

## Evidence and timeline

All times are UTC on 2026-07-30.

| Time      | Event                                                        | Confidence and source                                                                                      |
| --------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| ~06:14:58 | Work session starts                                          | Inferred from the Telegram duration (23m58s) and approximate notification time.                            |
| 06:35:34  | Hive Mind posts its working summary to PR 69                 | GitHub conversation comment `5127479150`.                                                                  |
| 06:35:36  | Attached solution log reaches “Uploading solution draft log” | Direct timestamp in `data/session.log.txt`. This establishes that the attached log is an interim snapshot. |
| 06:35:45  | The 2.5 MB log snapshot is posted to PR 69                   | GitHub conversation comment `5127481018`.                                                                  |
| 06:38:12  | PR 69 is merged                                              | GitHub PR `mergedAt`; merge commit `66d313017911459632542932c6bf19c3dd17e271`.                             |
| 06:38:13  | Merge-complete comment is posted                             | GitHub conversation comment `5127503934`.                                                                  |
| ~06:38:56 | Telegram reports exit code 1                                 | Inferred from the screenshot and displayed duration.                                                       |

The session log additionally records:

- `turn.completed` from Codex;
- all task items completed;
- successful local verification and fresh CI run `30519863272`;
- `✅ Codex command completed`;
- a clean worktree;
- discovery and readiness of PR 69.

It does **not** record:

- the outer process exception or stack;
- a start-command terminal footer;
- the final `$ --status` payload;
- Docker `State`, `OOMKilled`, or container exit metadata;
- output after the merge.

## Root-cause analysis

### Confirmed causes

1. `formatSessionCompletionMessage` classified the entire work session only from start-command status/exit code.
2. The monitor already discovered the pull request URL but did not inspect that PR’s terminal GitHub state.
3. Consequently, a real nonzero orchestration exit overwrote the equally real, externally verifiable success of the requested outcome.

This is a modeling and presentation bug: “runner failed” does not imply “requested pull request did not merge.”

### Unresolved lower-level cause

The nonzero exit happened after the available log snapshot. The inner solver’s normal path is designed to auto-merge, attach final logs, clean up, end the work session, and call `safeExit(0)`. Its catch path calls `safeExit(1)`. No second failure-log comment exists on PR 69, which weakly suggests that either:

- the failure occurred outside the captured `solve` logging boundary;
- a final attachment/cleanup/exit boundary failed without producing the expected failure artifact; or
- the detached runner reported a terminal status inconsistent with the inner task.

None can be distinguished with the retained data. The earlier start-command sentinel issue (`link-foundation/start#136`) concerns exit code `-1`, not the real exit code `1` seen here, so it is related background rather than proof or a duplicate.

### Why no upstream issue was filed

There is no minimal reproduction or component-specific trace that attributes the exit to start-command, Docker, GitHub CLI, or use-m. Filing against one would provide no actionable failing operation. The added completion-evidence trace records exit code, runner status, PR URL, merged state/time, and log path; a recurrence can now be correlated with the retained container and final runner log before reporting upstream.

## Codebase audit

The relevant end-to-end path was reviewed:

1. `src/solve.mjs` owns the inner solve/auto-merge/finalization lifecycle.
2. `src/isolation-runner.lib.mjs` reads detached start-command and Docker state, including terminal log-footer recovery.
3. `src/session-status.lib.mjs` normalizes exit codes and signal exits.
4. `src/session-monitor.lib.mjs` detects completion, resolves the linked PR, applies Docker retention, and creates the Telegram update.
5. `src/work-session-formatting.lib.mjs` chooses the completion headline.
6. `src/github.batch.lib.mjs` only returns **open** linked PRs; therefore the existing lookup cannot itself prove a PR is merged. The log fallback can recover the URL after merge.
7. Existing issue 1927/1939 tests correctly keep real nonzero exits authoritative. The issue 2117 fix does not turn exit 1 into exit 0 or weaken container retention.

## Solution

- On a non-kill failure with a resolved PR URL, query GitHub’s pull request endpoint for `merged` and `merged_at`.
- Keep ordinary failures unchanged when no merged PR is verified.
- Keep kill/signal reporting unchanged even if a PR exists.
- When both facts are true, use a warning headline and a two-line diagnostic explaining that the requested PR merged while the runner failed afterward.
- Emit verbose structured evidence sufficient to correlate a recurrence with the final session log.
- Cover both formatter behavior and the session-monitor integration with a regression test.

No new library is required. GitHub CLI is already the repository’s authenticated API transport; Node’s existing child-process API is already used by the monitor.

## Reproduction and verification

The minimum automated reproduction passes these inputs to the completion path:

- runner status `executed`;
- runner exit code `1`;
- a resolved PR whose GitHub state is `merged`.

Before the fix, the headline is `❌ Work session failed (exit code: 1)`. After the fix, it reports both outcomes and retains exit code 1.

Run:

```sh
node tests/test-issue-2117-merged-pr-exit.mjs
npm test
npm run lint
npm run format:check
```

## Follow-up investigation protocol

If the condition recurs:

1. Preserve the final start-command execution log, not only the mid-run PR attachment.
2. Capture `$ --status <session-id>` as JSON before cleanup.
3. Capture `docker inspect <container>` fields `State.Status`, `State.ExitCode`, `State.Error`, `State.OOMKilled`, `State.FinishedAt`, and health state.
4. Correlate those timestamps with the new completion-evidence log line and GitHub’s `merged_at`.
5. File upstream only when a minimal command shows the owning component returning an incorrect exit/status; include the command, versions, raw status, footer, and workaround.

## Sources

- GitHub REST pull-request API: <https://docs.github.com/en/rest/pulls/pulls>
- GitHub GraphQL pull-request fields: <https://docs.github.com/en/graphql/reference/objects#pullrequest>
- Docker run exit status: <https://docs.docker.com/engine/containers/run/#exit-status>
- Docker inspect: <https://docs.docker.com/reference/cli/docker/inspect/>
- Node child-process `close`/exit semantics: <https://nodejs.org/api/child_process.html>
- Related start-command report: <https://github.com/link-foundation/start/issues/136>

## Archived artifacts

`data/` contains the issue and all comments, PR 2118 metadata and all three comment/review streams, the linked use-m issue and PR with their comment/review streams, the exact log comment, the authenticated raw gist, the successful CI run metadata and 3,458-line log, and the issue screenshot. `SHA256SUMS` allows the archive to be checked for accidental modification.
