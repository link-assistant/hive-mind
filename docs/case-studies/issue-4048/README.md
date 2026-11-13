# Case study: auto-merge monitoring stuck for 12+ hours without "ready to merge" (issue #4048)

Issue: [#4048](https://github.com/link-assistant/hive-mind/issues/4048) "Our system stuck for long, and didn't announce `ready to merge` commit in multiple cases".
Implementation: [PR #4059](https://github.com/link-assistant/hive-mind/pull/4059).
Research date: 2026-11-13 UTC. Evidence: [`data/`](data/).

## Summary

Two `solve --auto-restart-until-mergeable` sessions polled a pull request for 11–14 hours. Neither printed anything beyond the periodic check lines, and neither posted "ready to merge". An operator then stopped both sessions. Both containers were SIGKILLed, the stop was not graceful, and in the public case the final log upload was cut off.

GitHub was **not** down for the whole time. The waits came from our own CI consensus logic:

- **A. Out-of-band failure (private repository).** A manually started `workflow_dispatch` workflow failed on the PR's HEAD commit. GitHub does not attach such check suites to the pull request, so GitHub reported the PR as `MERGEABLE`/`CLEAN`. `getMergeBlockers` correctly ignored the failure (#2031). The CheckRuns mechanism of `checkCIConsensus`, however, counted every check run on the commit and reported `failure`. The two signals disagreed for 296 consecutive checks.
- **B. Ghost runs (public, [link-foundation/link-cli#175](https://github.com/link-foundation/link-cli/pull/175)).** During the 2026-11-11 GitHub Actions/Webhooks incident, 36 workflow runs were created on three older PR commits. They stayed `queued` with `jobs.total_count = 0` and never started; they are still queued two days later. The AllCommits mechanism waited for them through 88 checks.
- **C. The stop was not graceful.** While the interrupt handler uploaded the log, the monitoring loop kept starting new checks. `docker stop` then SIGKILLed the container after Docker's default 10 s grace period.

## Data and privacy

As the issue requested, the private case is stored only as a minimal, redacted excerpt with Hive Mind output and nothing else:

- the repository, PR/issue numbers, run IDs, commit SHA, workflow name, container ID and product content are replaced with `owner/private-repo`, `PR #N`, `Manual evals`, `<run-id>`, `<head-sha>` and `<container-id>`;
- the issue's screenshot is described in words below rather than committed, because it shows the private repository.

The public link-cli data is stored in full.

| File                                                                                                | Content                                                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [`private-repo-redacted-excerpt.log`](data/private-repo-redacted-excerpt.log)                       | Case A: monitoring start, check #1, a typical DISAGREE check, the interrupt and the container post-mortem (redacted)                           |
| [`public-link-cli-pr175-monitoring.log`](data/public-link-cli-pr175-monitoring.log)                 | Case B: the whole monitoring phase of the public session, from the solution draft log upload through 88 checks to the SIGKILL (3566 lines)     |
| [`public-link-cli-pr175-ghost-runs.json`](data/public-link-cli-pr175-ghost-runs.json)               | Case B: all 36 runs that never started (REST `actions/runs` fields + `jobs.total_count`)                                                       |
| [`probe-ghost-runs-2026-11-13.log`](data/probe-ghost-runs-2026-11-13.log)                           | Output of [`experiments/issue-4048-probe-ghost-runs.mjs`](../../../experiments/issue-4048-probe-ghost-runs.mjs) on 2026-11-13: still 36 ghosts |
| [`githubstatus-incidents-2026-11-10-to-13.json`](data/githubstatus-incidents-2026-11-10-to-13.json) | githubstatus.com incidents from 2026-11-10 to 2026-11-13 (Statuspage `incidents.json`)                                                         |

### Screenshot from the issue (described, not stored)

The screenshot shows the private pull request after the stop. Hive Mind's comment reads **"❌ Working session was force-killed — forced kill — an operator requested the stop"**, with `Exit code: 137`, the working session UUID, `On-kill policy: resume (--on-session-kill=resume)`, a collapsed "Kill diagnostics" section, "The intermediate working-session log was uploaded as a separate comment" and a `solve <pr-url> …` command to continue manually.

Below the comment, GitHub shows **"This branch had an error being deployed — 1 failed deployment"** to a `staging` environment, created by the manually dispatched eval workflow on the HEAD commit. This is the out-of-band run of case A: GitHub shows it on the PR page but does not count it in the PR's merge state.

## Requirements

| #   | Requirement (issue text)                                                                                                     | Where it is addressed                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| R1  | Investigate the private case: 15 h without output, then the manual stop also failed                                          | [Case A](#case-a-out-of-band-failure-private-repository), [C](#case-c-stop)          |
| R2  | Investigate the public case link-foundation/link-cli#175                                                                     | [Case B](#case-b-ghost-runs-link-foundationlink-cli175)                              |
| R3  | Rule out a full GitHub outage (x.com/githubstatus, githubstatus.com)                                                         | [GitHub status](#was-github-down)                                                    |
| R4  | Use all GitHub infrastructure monitoring resources, to tell our own problems from a global outage                            | [S3](#s3-githubstatuscom-in-the-loop), [Monitoring resources](#monitoring-resources) |
| R5  | After an outage resolves, restart the CI/CD we wait on, but only runs that were queued and never executed                    | [S4](#s4-recover-ghost-runs-on-head-only-when-github-is-healthy)                     |
| R6  | Download all logs and data to `docs/case-studies/issue-4048`; keep private data to a minimum, no mention of the private repo | [Data and privacy](#data-and-privacy)                                                |
| R7  | Deep case study: timeline, requirements, root causes, solutions, existing libraries (online too)                             | This file                                                                            |
| R8  | Add debug output where the data is insufficient                                                                              | [S2](#s2-say-why-the-mechanisms-disagree)                                            |
| R9  | Report issues to other repositories with a reproduction, workaround and fix suggestion                                       | [Upstream](#upstream)                                                                |
| R10 | Apply the fix everywhere the same problem exists                                                                             | [S6](#s6-the-same-defect-elsewhere)                                                  |

## Timeline (UTC)

| When              | Event                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11-10             | githubstatus.com: critical "Git Operations / Pull Requests" incident (unrelated to both cases; listed for completeness).                                                                                        |
| 11-11 14:47:36    | **A**: container of the private session starts.                                                                                                                                                                 |
| 11-11 16:31:24    | **A**: solution draft log uploaded. This is the last visible output on the PR, the "stopped and showed nothing more" in the issue.                                                                              |
| 11-11 16:34:15    | **A**: check #1. `getMergeBlockers`: "PR is CLEAN/MERGEABLE according to GitHub; ignoring 1 stale CI failure". Consensus: `CheckRuns=failure` (10 checks, 9 passed, 1 failed: the dispatch run) → **DISAGREE**. |
| 11-11 17:29:54    | **B**: container of the link-cli#175 session starts.                                                                                                                                                            |
| 11-11 20:22–20:26 | githubstatus.com: minor incident "Incident with Webhooks".                                                                                                                                                      |
| 11-11 20:31:02    | **B**: first ghost runs created (commit `b12f92b`); they never get a job.                                                                                                                                       |
| 11-11 20:44:47    | **B**: ghost runs on `cc6008f`.                                                                                                                                                                                 |
| 11-11 20:48:12    | githubstatus.com: **critical** "Impact across multiple GitHub products including Actions, Pages, and Copilot products" (components include Actions and Webhooks).                                               |
| 11-11 20:52:42    | **B**: ghost runs on `fd1065f`.                                                                                                                                                                                 |
| 11-11 21:21:39    | githubstatus.com: incident resolved — "The backlog of Actions jobs has been fully processed." The 36 runs stay `queued` with zero jobs anyway.                                                                  |
| 11-12 00:13:34    | **B**: solution draft log uploaded; the "Solution Draft Log" comment is posted at 00:22:17.                                                                                                                     |
| 11-12 00:24:19    | **B**: check #1. HEAD `b482468`: 78/78 checks passed, PR `CLEAN`. AllCommits: "3 pending of 60" (`b12f92b`, `cc6008f`, `fd1065f`) → **DISAGREE**.                                                               |
| 11-12 04:52:24    | **B**: operator stop. The interrupt handler starts uploading the 41 MB log; meanwhile the loop starts check #88.                                                                                                |
| 11-12 04:52:34.45 | **B**: container SIGKILLed (exit 137), 10.06 s after the interrupt, after 87 DISAGREE checks and 40960 s alive. The kill notice is posted at 05:00:02.                                                          |
| 11-12 ~04:53:00   | **A**: operator stop; check #297 starts during the log upload.                                                                                                                                                  |
| 11-12 04:53:10.78 | **A**: container SIGKILLed (exit 137) after 296 DISAGREE checks and 50734 s alive.                                                                                                                              |
| 11-12, 11-13      | githubstatus.com: smaller incidents (Webhooks API, Email, Pull Requests, Copilot), none covering the whole period.                                                                                              |
| 11-13             | Issue #4048 opened. link-cli#175 is merged by hand at 21:09:06; the 36 ghost runs are **still** queued ([probe](data/probe-ghost-runs-2026-11-13.log)).                                                         |

## Was GitHub down?

No. [`githubstatus-incidents-2026-11-10-to-13.json`](data/githubstatus-incidents-2026-11-10-to-13.json) lists every incident in the window. The only one touching Actions lasted 33 minutes (20:48–21:21 on 11-11). Both sessions kept getting correct API answers before, during and after it: CI status, workflow runs and merge state in every check.

- **Case A** has no relation to GitHub at all: the failure was a real (manual) workflow failure.
- **Case B**'s ghost runs were _created_ by the 11-11 incident: all three batches fall inside the Webhooks/Actions disruption. They were never cleaned up by GitHub. Community reports describe the same symptom (runs stuck in `queued`, `jobs.total_count = 0`, cancel answered with 409/500) after Actions incidents: [community#196717](https://github.com/orgs/community/discussions/196717), [actions/runner#3872](https://github.com/actions/runner/issues/3872).

The incident explains where the ghost runs came from, but not why we waited forever: Hive Mind had no rule for a run that will never start.

[x.com/githubstatus](https://x.com/githubstatus) mirrors the same Statuspage incidents. It has no free API, so the machine-readable sources below are the ones the code uses.

## Root causes

### Case A: out-of-band failure (private repository)

[`private-repo-redacted-excerpt.log`](data/private-repo-redacted-excerpt.log), check #1:

```
[VERBOSE] /merge:   Total: 10, Passed: 9, Failed: 1, Cancelled: 0, Stale: 0, Pending: 0, Queued: 0
[VERBOSE] /merge: PR #N mergeable: true, state: CLEAN, isDraft: false
[VERBOSE] /merge: PR #N is CLEAN/MERGEABLE according to GitHub; ignoring 1 stale CI failure/cancellation blocker(s) from the raw check-run rollup
...
[VERBOSE] consensus: CheckRuns=false(failure), WorkflowRuns=true(2), AllCommits=skip, RepoActions=skip → DISAGREE
  🔄 CI mechanisms DISAGREE: CheckRuns=failure, WorkflowRuns=0 in-progress, AllCommits=skipped, RepoActions=skipped
  ⏳ Continuing to monitor... Mechanisms must agree before declaring mergeable
```

`GET /commits/{sha}/check-runs` returns check runs from **every** check suite on the commit, including `workflow_dispatch`, `schedule`, `repository_dispatch` and `workflow_run` suites. GitHub does not associate those suites with a pull request, so they never reach the PR's `statusCheckRollup` or merge state. This is why the PR stayed `CLEAN`. Issue #2031 already taught `getMergeBlockers` to trust `CLEAN`, but `checkCIConsensus` (#1503) required its CheckRuns mechanism to be `success` without exception. The two rules can never agree while the failed dispatch run exists, and nothing ever re-runs it.

The log line also gave no hint _which_ check failed, so the operator saw only an endless stream of identical "DISAGREE" lines.

### Case B: ghost runs (link-foundation/link-cli#175)

[`public-link-cli-pr175-monitoring.log`](data/public-link-cli-pr175-monitoring.log), last check:

```
[VERBOSE] /merge:   Total: 78, Passed: 78, Failed: 0, Cancelled: 0, Stale: 0, Pending: 0, Queued: 0
[VERBOSE] /merge: PR #175 mergeable: true, state: CLEAN, isDraft: false
[VERBOSE] pr-commits: 3/60 commits have in-progress CI: b12f92b, cc6008f, fd1065f
[VERBOSE] consensus: CheckRuns=true(success), WorkflowRuns=true(12), AllCommits=false(60 commits, 3 pending), RepoActions=skip → DISAGREE
```

The AllCommits mechanism (#1503) waits until every run on every PR commit is `completed`. A run stuck in `queued` with zero jobs is not waiting for a runner; GitHub never created its jobs and will never start it. [`public-link-cli-pr175-ghost-runs.json`](data/public-link-cli-pr175-ghost-runs.json) shows that all 36 such runs have `run_started_at == created_at` and `jobs.total_count == 0`. No timeout existed for this case, and no attempt was made to recover the runs.

<a id="case-c-stop"></a>

### Case C: the stop was not graceful

```
[interrupt] +1ms handler entered
⚠️  Session interrupted by user (CTRL+C)
[interrupt] +135ms log-upload: start
📈 [RESOURCES] phase=log_upload_start ts=2026-11-12T04%3A52%3A24.391Z ...
  📎 Uploading log using gh-upload-log...
🔍 Check #88:                4:52:24 AM          ← the monitoring loop keeps working
...
Exit Code:  137 (SIGKILL - 128+9)
FinishedAt: 2026-11-12T04:52:34.453264659Z     ← 10.06 s after the interrupt
```

There are two causes:

1. **Ours.** The exit handler runs the interrupt work (auto-commit, draft restore, log upload) asynchronously. The `interruptibleSleep` in the monitoring loop woke up from the signal and the loop simply started the next check: more API calls, more log lines and more CPU while the upload competed for the 10 s budget.
2. **Upstream.** `$ --stop <uuid>` (link-foundation/start) maps to a plain `docker stop <container>`, which waits only Docker's default 10 s before SIGKILL. A 41 MB upload cannot finish in 10 s. The repository already knew about this race (comment for #2052 in `src/solve.interrupt.lib.mjs`). There was no upstream issue yet: [link-foundation/start#265](https://github.com/link-foundation/start/issues/265).

## Solutions

### S1. Out-of-band checks do not decide mergeability

[`src/github-ci-stuck-runs.lib.mjs`](../../../src/github-ci-stuck-runs.lib.mjs):

- `partitionOutOfBandChecks` joins each non-passing check run to its workflow run through the check suite id (`check_run.check_suite.id === workflow_run.check_suite_id`). A check is dropped only if its run's event is `workflow_dispatch`, `schedule`, `repository_dispatch` or `workflow_run`. A check with no matching workflow run (third-party apps, commit statuses) still counts.
- `checkCIConsensus` ([`src/github-merge-repo-actions.lib.mjs`](../../../src/github-merge-repo-actions.lib.mjs)) uses it for the CheckRuns mechanism. It also gets the PR's merge state: when GitHub says `mergeable=true`, `MERGEABLE` and `CLEAN`, and nothing is pending or queued, the CheckRuns mechanism agrees, exactly like `getMergeBlockers` (#2031). `UNSTABLE`, `BLOCKED` or queued checks still block.
- On agreement, the loop logs the ignored check and its run URL, so the decision is visible.

### S2. Say why the mechanisms disagree

`describeConsensusDisagreement` turns the mechanisms into readable reasons, for example `CheckRuns: failure — evals (manual) (failure)` or `AllCommits: 3 of 60 commits have runs not completed (b12f92b, cc6008f, fd1065f)`. Each DISAGREE check logs them, together with each ignored ghost run.

[`src/solve.auto-merge-stuck-ci.lib.mjs`](../../../src/solve.auto-merge-stuck-ci.lib.mjs) counts identical consecutive disagreements. After `HIVE_MIND_CONSENSUS_DISAGREE_NOTICE_CHECKS` (default 15, about 30 minutes), it posts **one** PR comment per HEAD commit, headed `⚠️ CI wait is stuck`. The comment lists the reasons, the stuck runs, the current GitHub status and the overlapping incidents. A silent 12-hour wait becomes a visible one within half an hour.

### S3. githubstatus.com in the loop

[`src/provider-status.lib.mjs`](../../../src/provider-status.lib.mjs) already polled the Claude and OpenAI status pages (#4053). It now also knows GitHub (`HIVE_MIND_GITHUB_STATUS_URL`, default `https://www.githubstatus.com`):

- `fetchProviderStatus('github')` reads `/api/v2/summary.json`. It treats an incident or degraded component among Actions, Webhooks, API Requests, Git Operations and Pull Requests as "GitHub has issues".
- `fetchProviderIncidents` reads `/api/v2/incidents.json`, and `findIncidentsOverlapping` keeps the incidents overlapping the time a run has been stuck. These are logged and named in the notice, which separates "GitHub is broken" from "our wait is broken".

Both functions never throw. If the status page is unreachable, the result is "unknown", and unknown is never treated as healthy.

### S4. Recover ghost runs on HEAD only when GitHub is healthy

`findGhostQueuedRuns` returns runs that are `queued`, older than `HIVE_MIND_STUCK_QUEUED_RUN_MINUTES` (default 30, measured from `run_started_at`, so a re-run attempt gets a fresh clock), and have **zero** jobs. It rules out:

- a run waiting for a runner, which already has queued jobs;
- runs held by a concurrency group, which are `pending`;
- runs waiting for approval, which are `waiting`;
- a run whose job count could not be read, which keeps blocking.

What happens to them depends on where they are:

- **Older commits** (case B): ghost runs are ignored by AllCommits and reported. HEAD is what will be merged, and these runs will never run.
- **HEAD**: ghost runs are never ignored. `decideGhostRunAction` decides:
  - an active GitHub incident means wait for GitHub;
  - an unreachable status page means wait, because an outage cannot be ruled out;
  - otherwise each run is re-triggered at most `HIVE_MIND_STUCK_RUN_RERUN_ATTEMPTS` times (default 2). A queued run cannot be re-run directly, so it is cancelled first (`POST …/cancel`, falling back to `POST …/force-cancel`, see the [force-cancel changelog](https://github.blog/changelog/2023-09-21-github-actions-force-cancel-workflows/)). It is re-run (`POST …/rerun`) once GitHub reports it `completed`.
  - Runs that started on their own are not ghosts and are never touched. When the attempts are exhausted, the notice is posted at once and asks for a human.

This implements R5: only runs that were queued and never executed are restarted, and only after GitHub reports the incident as resolved.

### S5. A stop means stop

`exit-handler.lib.mjs` marks the shutdown (`markShutdownInProgress`) before it runs the interrupt work. From then on, `interruptibleSleep` returns immediately and `parkIfShuttingDown` parks the auto-merge, watch and auto-continue loops until `process.exit`. They no longer start new checks or resume a session during the stop. The upload gets the whole grace period. A longer grace period itself needs the upstream change in [link-foundation/start#265](https://github.com/link-foundation/start/issues/265).

<a id="s6-the-same-defect-elsewhere"></a>

### S6. The same defect elsewhere

| Place                                                                                                     | Same problem?                                                                                                                                               | Change                                                                                             |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `checkPRCIStatus` (`/merge` queue, `waitForCI`, auto-merge attempt)                                       | Yes. It counted every HEAD check run: a failed dispatch run made `/merge` skip a `CLEAN` PR as "CI failed", and a long-running one kept `waitForCI` pending | `dropOutOfBandChecks` before computing the status; out-of-band checks are marked in verbose output |
| `checkAllPRCommitsCI` / AllCommits                                                                        | Yes (case B)                                                                                                                                                | Ghost runs on older commits are ignored and reported                                               |
| Watch loop (`solve.watch.lib.mjs`), auto-continue (`solve.auto-continue.lib.mjs`)                         | Yes (case C): both loop over `interruptibleSleep`                                                                                                           | `parkIfShuttingDown`                                                                               |
| `waitForCI`, `waitForBranchCI`, `waitForCommitCI`                                                         | No: they are bounded by explicit timeouts                                                                                                                   | –                                                                                                  |
| `getMergeBlockers` when the PR is not `CLEAN`                                                             | Deliberately unchanged: without GitHub's `CLEAN` verdict, a failed check on HEAD should keep blocking                                                       | –                                                                                                  |
| Static "check githubstatus.com" hints (`solve.repository`, `solve.repo-setup`, `solve.branch-divergence`) | They only print a link; no wait depends on them                                                                                                             | –                                                                                                  |

## Monitoring resources

All endpoints were checked on 2026-11-13 (HTTP 200).

| Resource                                                                           | Use                                                                                                |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `https://www.githubstatus.com/api/v2/summary.json`                                 | Current indicator, per-component status, unresolved incidents. **Used** (`fetchProviderStatus`).   |
| `https://www.githubstatus.com/api/v2/incidents.json`                               | Last 50 incidents with `created_at`/`resolved_at`/components. **Used** (`fetchProviderIncidents`). |
| `https://www.githubstatus.com/api/v2/incidents/unresolved.json`, `components.json` | Subsets of `summary.json`; not needed separately.                                                  |
| `https://www.githubstatus.com/history.atom`, `history.rss`                         | Same incidents as feeds, for humans and feed readers; the JSON API is easier to parse.             |
| [x.com/githubstatus](https://x.com/githubstatus)                                   | Mirrors Statuspage posts; no free API. Linked for humans.                                          |
| REST `GET /repos/{o}/{r}/actions/runs/{id}/jobs`                                   | `total_count = 0` is the ghost-run signal. **Used**.                                               |
| REST `POST …/actions/runs/{id}/cancel`, `force-cancel`, `rerun`                    | Recovery of ghost runs on HEAD. **Used** (`cancelWorkflowRun`, `rerunWorkflowRun`).                |
| GraphQL `mergeable` / `mergeStateStatus`                                           | GitHub's own verdict; **used** as the authority over raw check runs.                               |

### Existing tools considered

- [Octokit](https://github.com/octokit/octokit.js) and `gh run cancel` / `gh run rerun` cover the same REST endpoints. Hive Mind already shells out to `gh api` everywhere, so no new dependency was added.
- [mrshu/github-statuses](https://github.com/mrshu/github-statuses) archives githubstatus.com history (Flat Data). It is useful for post-mortems, but not needed at runtime: `incidents.json` covers the recent window.
- Statuspage-based monitors such as Pingoru or the Apify githubstatus scrapers poll the same public API. They add no information the API lacks.
- No library was found that detects "queued with zero jobs" runs. The community answer is the manual check of `jobs.total_count` plus force-cancel ([community#196717](https://github.com/orgs/community/discussions/196717), [actions/runner#3872](https://github.com/actions/runner/issues/3872)), which is what S4 automates.

## Configuration

| Variable                                     | Default                        | Meaning                                                                                                    |
| -------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `HIVE_MIND_STUCK_QUEUED_RUN_MINUTES`         | `30`                           | A run `queued` with zero jobs for longer than this is a ghost run                                          |
| `HIVE_MIND_STUCK_RUN_RERUN_ATTEMPTS`         | `2`                            | Cancel + re-run attempts per ghost run on HEAD; `0` disables recovery                                      |
| `HIVE_MIND_CONSENSUS_DISAGREE_NOTICE_CHECKS` | `15`                           | Identical consecutive disagreements before the PR notice is posted; `0` disables it                        |
| `HIVE_MIND_GITHUB_STATUS_URL`                | `https://www.githubstatus.com` | Statuspage base URL for GitHub (e.g. a mirror or GitHub Enterprise status page)                            |
| `HIVE_MIND_PROVIDER_STATUS_CHECK`            | `true`                         | `false` skips all status-page lookups; ghost runs on HEAD are then re-triggered without the incident check |

## Verification

[`tests/issue-4048-stuck-ci-consensus.test.mjs`](../../../tests/issue-4048-stuck-ci-consensus.test.mjs) (default suite, no network) replays both cases. Every "before" test reproduces the hang with the old call shape; every "after" test asserts the fix:

- **Case A**:
  - the old call disagrees forever, while the new one agrees and names the ignored check;
  - `CLEAN` overrides a stale failure, but `UNSTABLE`/`BLOCKED`/queued do not;
  - a failing `pull_request` check is never out-of-band;
  - `checkPRCIStatus` drops out-of-band checks for the `/merge` queue.
- **Case B**: the real 36 runs from [`public-link-cli-pr175-ghost-runs.json`](data/public-link-cli-pr175-ghost-runs.json):
  - the old AllCommits waits forever;
  - the new one ignores and reports the ghosts;
  - runs with jobs, young runs or runs with an unknown job count still block;
  - ghosts on HEAD are never ignored.
- **githubstatus.com**: the real incidents from [`githubstatus-incidents-2026-11-10-to-13.json`](data/githubstatus-incidents-2026-11-10-to-13.json) overlap the ghost window, and an active Actions incident means "wait".
- **Recovery**:
  - cancel → force-cancel → re-run after completion;
  - wait during an incident;
  - bounded attempts;
  - one notice per commit.
- **Case C**: after shutdown starts, every sleep returns at once and the loops park.

[`experiments/issue-4048-probe-ghost-runs.mjs`](../../../experiments/issue-4048-probe-ghost-runs.mjs) is a read-only probe for any PR. Run on link-cli#175, it found the 36 ghost runs and the three overlapping incidents ([output](data/probe-ghost-runs-2026-11-13.log)).

## Upstream

- [link-foundation/start#265](https://github.com/link-foundation/start/issues/265): `$ --stop` on docker executions uses Docker's default 10 s grace period; it asks for a configurable stop timeout. The issue includes the public evidence above, a reproduction, a workaround (`docker stop -t 120 <container>`) and a fix suggestion for both the JS and Rust implementations.
- GitHub's ghost runs are a known platform behaviour after Actions incidents (see the community links above). They need no new report; the fix is to stop waiting for them.

## Remaining limits

- Until link-foundation/start#265 is implemented, a stop still gives the interrupt handler only 10 s. S5 makes the most of those 10 s, but a 41 MB upload can still be cut off.
- If cancel and force-cancel are both refused for a ghost run on HEAD (HTTP 409/500 in community reports), Hive Mind cannot recover it. In that case it posts the notice and keeps the PR un-announced, because HEAD's CI really has not run.
