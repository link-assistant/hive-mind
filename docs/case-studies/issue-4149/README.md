# Case study: false positives, false negatives, warnings and errors in CI/CD (issue #4149)

Issue: [#4149](https://github.com/link-assistant/hive-mind/issues/4149).
Implementation: [PR #4150](https://github.com/link-assistant/hive-mind/pull/4150).
Research date: 2026-11-25 UTC. Evidence: [`dev/log/issues/4149/pulls/4150`](../../../dev/log/issues/4149/pulls/4150/README.md).
Previous round: [issue #4055](../issue-4055/README.md) (PR #4056).

## Requirements

| #   | Requirement (issue text)                                                                         | Where it is addressed                                                                  |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| R1  | Find and fix every false positive, false negative, warning and error in CI/CD                    | Findings F1–F4, F3 and B1 below                                                        |
| R2  | The runs listed in the issue comment: Formal AI Draft 45629684702, Dependabot Health 45513290782 | F1, F3                                                                                 |
| R3  | Compare CI/CD with the js, python, rust and cpp templates; report the same defects there         | [Template comparison](#template-comparison)                                            |
| R4  | Follow `docs/CI-CD-BEST-PRACTICES.md`                                                            | A regression test for every fix; principle 17 extended in 4 languages                  |
| R5  | Collect logs into `dev/log/issues/4149/pulls/4150`; timeline; root causes; online facts          | This file and the evidence folder                                                      |
| R6  | Debug output where data is missing (off by default); upstream reports with repro and fix         | F2 `DISPATCH_CHECKS_VERBOSE=true`; [Upstream](#upstream)                               |
| R7  | Apply each fix everywhere it applies; do everything in one pull request                          | F1: every gh retry wrapper and every read-only call site (32 files); F4: 4 Dockerfiles |

## Timeline (UTC)

| When             | Event                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-20 14:36 | Dependabot opens #4105 (sanitizer 1.0.0 and Sentry group). `main` later gets both versions another way, so #4105 is superseded and its branch conflicts (`DIRTY`).                                            |
| 2026-11-23 22:33 | `main` push 045fdf675: Checks and release 45280760241 passes, but `detect-changes` warns 8 times `formal-ai 0.356.10 -> 0.356.11` for the four Dockerfiles (F4).                                              |
| 2026-11-24 23:51 | Dependabot Health 45513290782 fails: `#4105 3 unfinished "Dependabot is rebasing this PR" banners` (F3).                                                                                                      |
| 2026-11-25 12:56 | Formal AI drafts 45618587462, 45618589696 and 45618594320 start for open issues.                                                                                                                              |
| 2026-11-25 13:18 | The draft of 45618587462 dispatches `release.yml` (`mode: checks`) for a3d8593cb. GitHub creates run 45622194807 at 13:18:15, 3 s later.                                                                      |
| 2026-11-25 13:20 | `dispatch-checks` gives up after 2 minutes of `gh run list --workflow release.yml --branch … --event workflow_dispatch` returning nothing: `Dispatched release.yml, but no run appeared for a3d8593cb…` (F2). |
| 2026-11-25 13:33 | Scheduled cleanup 45624825910 warns `1384 fixture branch(es) retained by a repository rule that prohibits deletion` (B1).                                                                                     |
| 2026-11-25 14:02 | Issue #4149 is opened; Formal AI draft 45629684702 starts for it.                                                                                                                                             |
| 2026-11-25 14:12 | PR #4150 is opened.                                                                                                                                                                                           |
| 2026-11-25 14:39 | `report-checks` of 45629684702 (14:39:22) and of 45618594320 (14:39:28) both fail on one `gh api` poll that prints only `unexpected end of JSON input` (F1).                                                  |
| 2026-11-25 15:2x | This pull request: the four template issues are filed and the comment on cli/cli#10579 is posted.                                                                                                             |

## Findings, root causes and fixes

| #   | Kind           | Where                                            | Status                      |
| --- | -------------- | ------------------------------------------------ | --------------------------- |
| F1  | False positive | `report-checks` of Formal AI drafts (2 runs)     | Fixed                       |
| F2  | False positive | `dispatch-checks` of a Formal AI draft           | Fixed                       |
| F3  | True positive  | Dependabot Health: #4105 stuck in rebase         | Maintainer action (blocked) |
| F4  | Warning        | `detect-changes` freshness: formal-ai 0.356.10   | Fixed                       |
| B1  | Warning        | Cleanup: 1384 fixture branches cannot be deleted | Blocked (repository admin)  |

### F1. False positive: one cut-off GitHub reply fails `report-checks`

- **Evidence.** Runs 45629684702 and 45618594320, job `report-checks`, step
  `Report the dispatched checks on the draft head`, 6 seconds apart:

  ```text
  2026-11-25T14:39:22.8163324Z unexpected end of JSON input
    stderr: 'unexpected end of JSON input\n'
  ##[error]Process completed with exit code 1.
  ```

  Two unrelated runs failing in the same seconds point to GitHub, not to the drafts.

- **Root cause.** When GitHub answers an HTTP error with an empty or truncated body,
  gh's `parseErrorResponse` (`pkg/cmd/api/api.go`) fails to decode it and prints
  only the JSON decoder's `unexpected end of JSON input`, hiding the status
  ([cli/cli#10579](https://github.com/cli/cli/issues/10579), open). Our transient
  classifier (`src/transient-errors.lib.mjs`) did not know that message, so the
  retry wrappers rethrew at once. `scripts/formal-ai-draft-checks.mjs` polls the
  dispatched runs for up to an hour, and one failed poll ended the whole job.
- **Why not simply add it to the transient patterns.** The status is hidden, so
  the request may have reached GitHub. Retrying a write could duplicate a comment,
  a dispatch or a merge (issue #2571's lesson). The message is a transient fault
  only for reads.
- **Fix.**
  - `src/transient-errors.lib.mjs`: `GITHUB_TRUNCATED_REPLY_PATTERNS`,
    `isTruncatedGitHubReply()`, and `describeTransientError(error, { truncatedReplyIsTransient })`
    (category `github-truncated-reply`). The default stays non-transient.
  - `src/github-operation-retry.lib.mjs`: `classifyGitHubCommand()` returns
    `readOnly` (`gh api` with GET and no body, and `view/list/status/diff/checks/…`
    verbs); the retry policy takes `retryTruncatedReply`.
  - Every wrapper passes it: `execSyncWithRetry`, `wrapRunnerWithTransientRetry`,
    `ghWithRateLimitRetry`, `execGhWithRetry`, `wrapDollarWithGhRetry`, `ghRetry`,
    `ghCmdRetry`, `scripts/github-retry.mjs`, the `gh` helper in
    `scripts/github-actions.lib.mjs`, and `scripts/repair-release-notes.mjs`.
  - Every call site that runs only reads opts in: the 8 `execRaw` helpers of the
    merge queue, invitations and `solve.accept-invite`, the read closures in
    description edits, the PR base guard, PR changes, hive-manager task/archive,
    organize, issue-link verification, and 12 GET `ghCmdRetry` sites.
  - `scripts/formal-ai-draft-checks.mjs`: a failed poll is a
    `::warning title=Checks poll failed::`, and the job fails only after
    `MAX_CONSECUTIVE_POLL_FAILURES = 10` failures in a row (`recordPollFailure()`).
- **Tests.** `tests/ci-false-positives-4149.test.mjs`: the classifier; the retry
  policy with and without the flag (3 attempts vs 1); `execGhWithRetry` with a
  fake `gh` on `PATH` (`gh pr view` 3 attempts, `gh pr comment` 1);
  `wrapDollarWithGhRetry`; `recordPollFailure`.
  `experiments/issue-4149/truncated-reply-retry.mjs` shows the same before and
  after: on 0e90eb003 the read makes 1 attempt and fails; with the fix it makes 3
  and succeeds.

### F2. False positive: `dispatch-checks` cannot see the run it dispatched

- **Evidence.** Run 45618587462, job `Formal AI draft`, 13:20:26:
  `Error: Dispatched release.yml, but no run appeared for a3d8593cb6b95befcc909a6693c8927f1e44b2d6`.
  The run exists: 45622194807, `Checks and release`, `workflow_dispatch`,
  head a3d8593cb, created 13:18:15.
- **Root cause.** The script dispatched with `gh workflow run` and then looked
  the run up with a filtered `gh run list --workflow --branch --event`. GitHub's
  filtered run listing is eventually consistent and stayed empty for the whole
  2-minute window. A dispatch that succeeded was reported as a failure.
- **Fix.** `scripts/dispatch-checks.lib.mjs` (new) and `scripts/dispatch-checks.mjs`:
  - dispatch through `POST …/actions/workflows/{workflow}/dispatches` with
    `return_run_details: true`. GitHub answers 200 with `workflow_run_id`,
    `run_url` and `html_url` ([GitHub changelog 2026-02-19](https://github.blog/changelog/2026-02-19-workflow-dispatch-api-now-returns-run-ids); `gh workflow run` sends the same field since gh 2.87.0);
  - fall back to `GET …/actions/runs?head_sha=…&event=workflow_dispatch` for up to
    3 minutes only when the response has no run (204 from older GHES);
  - a run that still cannot be found is a `::warning title=Dispatched run not found::`.
    The dispatch succeeded, and `report-checks` already posts a failing status
    for a check that never reports;
  - `DISPATCH_CHECKS_VERBOSE=true` (or a re-run with debug logging) prints the
    dispatch response and every lookup. Off by default.
- **Tests.** `tests/ci-false-positives-4149.test.mjs` (request body, response
  parsing, run matching, warning, no `gh run list` and no throw left);
  `tests/dispatch-checks-inputs-2625.test.mjs` updated to read the allow list from
  the new library. `experiments/issue-4149/dispatch-run-details.mjs` prints the
  request, and with `--dispatch` shows the response next to the listing.

### F3. True positive: Dependabot pull request #4105 is stuck (maintainer action)

- **Evidence.** Dependabot Health 45513290782:
  `##[error]#4105 3 unfinished "Dependabot is rebasing this PR" banners`.
  #4105 is open and `DIRTY` (`pr-4105.json`). It bumps sensitive-data-sanitizer to
  1.0.0 and the Sentry group, and `main` already has `^1.0.0` and `^11.17.0`.
- **Root cause.** Dependabot cannot rebase a superseded group update. The check is
  right to fail and already says what to do: `Merge it if it is still current, otherwise close it`.
- **Status.** Blocked on a maintainer: close #4105 (superseded). There is nothing
  to change in code. Closing someone else's pull request is outside this pull request's scope.

### F4. Warning: stale formal-ai pin

- **Evidence.** `main` 045fdf675, `detect-changes`: 8 warnings
  `formal-ai 0.356.10 -> 0.356.11 (exact)` (`annotations.tsv`).
- **Fix.** formal-ai 0.356.11 in `Dockerfile`, `Dockerfile.dind`,
  `Dockerfile.formal-ai`, `coolify/Dockerfile`, `src/formal-ai-version.lib.mjs` and
  its test. The same freshness gate on this branch also required zizmor-action
  v0.9.2, agent-commander ^0.13.0 and eslint-plugin-n ^18.6.0; all are updated.

### B1. Warning: 1384 fixture branches retained (repository admin)

- **Evidence.** Cleanup 45624825910: `1384 fixture branch(es) retained by a
repository rule that prohibits deletion`. Ruleset 21204104
  `no-destruction-possible` targets `~ALL` branches with `deletion` and
  `non_fast_forward` and has no bypass actors (`ruleset-21204104.json`).
- **Status.** The warning is intended (#4025): the job cannot delete the branches
  and says so. Only a repository admin can add a bypass actor or exclude
  `issue-*` fixture branches. Blocked; nothing changed here.

### By design (not defects)

- Formal AI drafts that end with `Finished without changes` (exit code 5) report a
  draft that produced nothing; see [`docs/FORMAL-AI-DRAFTS.md`](../../FORMAL-AI-DRAFTS.md).
- E2E Hello World Matrix is `skipped` unless `vars.ENABLE_REAL_GITHUB_E2E` is set.

## Template comparison

Checked at js 8e72538, python 7a05d05, rust 1d29f55, cpp c1c60fb. F2 and F4 do not
occur there: the templates do not dispatch-and-look-up runs, and their pins are
current. The F1 class (a gh/API call in CI with no retry, so one GitHub blip fails
a job) occurs in all four. Each reproduction was run against the clone.

| Template | Where                                                                                                                               | Issue                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| js       | `land-via-pull-request.mjs:204-227` (retries only "no checks reported"), `rerun-unacquired.mjs`, `check-deprecated-packages.mjs:39` | [js#318](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/318)         |
| python   | `check_zizmor_compatibility.py:28-33` (runs on pull requests), `version_and_commit.py:149-164`                                      | [python#169](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/169) |
| rust     | `unacquired-jobs.py:42-47` `gh()` raises, `command_rerun` does not catch it                                                         | [rust#273](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/273)     |
| cpp      | `unacquired_jobs.py:91-95` `gh()` raises, `rerun()` does not catch it; `check_release_needed.py:41-49`                              | [cpp#44](https://github.com/link-foundation/cpp-ai-driven-development-pipeline-template/issues/44)         |

The issue bodies are saved in `dev/log/issues/4149/pulls/4150/template-issues/`.

## Upstream

- **gh hides the status of an error with an empty body.**
  [cli/cli#10579](https://github.com/cli/cli/issues/10579) already tracks
  `unexpected end of JSON input`. A comment adds our evidence, a reproduction, the
  read-only retry workaround, and a fix suggestion: in `parseErrorResponse`, when
  the body is empty or not JSON, report `HTTP <status>` instead of the decoder
  error: <https://github.com/cli/cli/issues/10579#issuecomment-7166867052>.

## Existing tools considered

- gh has no built-in retry for `gh api` (`--retry` is not an option). The
  `actions/github-script` retry plugin (`@octokit/plugin-retry`) retries only
  Octokit calls, and retries 5xx for every method, which is exactly what #2571
  rules out for writes. hive-mind's own retry stack is already used everywhere,
  so the fix extends it instead of adding a dependency.
- GitHub's `return_run_details` dispatch field replaces the run lookup and needs
  no library.
