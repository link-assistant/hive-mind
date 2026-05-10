# Issue 1769 Case Study: Cancelled CI Re-run Permission Failure

## Summary

Issue #1769 was caused by an auto-merge watcher edge case. Hive Mind detected a cancelled required CI check, attempted to re-run the owning GitHub Actions workflow, received a permissions error from GitHub, and then continued waiting as if a re-run had started.

The fix changes cancelled/stale CI handling so the watcher only waits when an automatic re-run actually starts. If no re-run can start, it posts a PR comment asking a maintainer to review the cancelled CI and exits with `ci_cancelled_requires_review`.

## Evidence Collected

All downloaded evidence is preserved under `docs/case-studies/issue-1769/evidence/`.

- `issue-1769.json` - issue metadata from `link-assistant/hive-mind#1769`.
- `tmp-start-command-logs-isolation-screen-35fc4ce8-b33f-4f50-bd95-02a228b14e82.log.gz` - compressed full private working-session log referenced by the issue.
- `docker-git-run-25595105760.json` - GitHub run summary for `ProverCoderAI/docker-git` run `25595105760`.
- `docker-git-run-25595105760-jobs.json` - job/step API details for the same run.
- `docker-git-run-25595105760.log.gz` - compressed downloaded GitHub Actions log for the cancelled run.
- `docker-git-issue-215-runs.json` - related recent run list for the source branch.

The large private log was downloaded with authenticated GitHub access. The `file` utility was not installed in this workspace, so the downloaded artifacts were validated with size checks and by reading the uncompressed logs as UTF-8 text before analysis. The committed log copies are gzip-compressed to preserve original log content without making whitespace checks scan raw CI output.

## Timeline

- 2026-05-09T06:43:41Z - The source PR work session started on `ProverCoderAI/docker-git#242`.
- 2026-05-09T07:16:31Z - GitHub Actions run `25595105760` (`Check`) was created for head SHA `188b756629c97061b0b62d4b5450ed47224502ae`.
- 2026-05-09T07:17:07Z - Job `E2E (Clone cache)` entered the `Install dependencies` step.
- 2026-05-09T07:56:53Z - The Actions log recorded `The operation was canceled.` The job API reports `Install dependencies` as `cancelled`; later test steps were skipped.
- 2026-05-09T07:57:33Z - A working-session summary noted that all checks except `E2E (Clone cache)` passed and that `gh run rerun --failed` was rejected with `Must have admin rights to Repository`.
- 2026-05-09T09:27:08Z approx - Hive Mind `Check #42` observed PR detailed CI status `cancelled`, found the cancelled `Check` workflow run, and attempted to re-trigger it.
- 2026-05-09T09:27:08Z approx - The re-run attempt failed: `gh: Must have admin rights to Repository. (HTTP 403)`.
- 2026-05-09T09:27:08Z approx - The watcher still logged `Waiting for re-triggered CI`, even though no re-run had started.
- 2026-05-09T09:29:41Z - The run was interrupted by the user with `CTRL+C`.

## Root Cause

`watchUntilMergeable` treated cancelled CI as a non-AI-restart case and attempted to re-trigger cancelled/stale workflow runs. That part was correct for recoverable cancellation. The bug was the failed re-run path:

1. `rerunWorkflowRun()` returned `{ success: false, error: "gh: Must have admin rights to Repository. (HTTP 403)" }`.
2. The watcher logged the warning.
3. No terminal state was set.
4. The cancelled blocker remained in place.
5. The next part of the loop continued to wait for CI, creating an indefinite wait on an unchanged cancelled check.

This is visible in the private log around lines `79852` to `79861`.

## External GitHub Behavior

GitHub documents that re-running workflows requires repository write permission in the web UI and Actions write permission for the REST API. The REST re-run endpoint returns `201 Created` on success, so a `403` means Hive Mind cannot assume a new run exists.

Relevant GitHub docs:

- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs?tool=webui
- https://docs.github.com/en/rest/actions/workflow-runs

GitHub also documents that workflow/job timeout behavior can cancel a job. In this case the API exposed the job conclusion as `cancelled`, while the downloaded run log showed cancellation during dependency installation. That means Hive Mind should not blindly treat `cancelled` as safe or ignorable when it cannot re-run the workflow.

Relevant GitHub docs:

- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idtimeout-minutes
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation

## Fix

The implementation now:

- Extracts cancelled/stale CI re-run helpers into `src/cancelled-ci-rerun.lib.mjs`.
- Filters re-trigger candidates to workflow runs with `cancelled` or `stale` conclusions.
- Tracks whether any automatic re-run actually succeeded.
- Stops with `ci_cancelled_requires_review` if no run can be re-triggered, including the permission-denied case.
- Posts a PR comment with cancelled check details, inspected workflow runs, the exact re-run failure, and maintainer actions:
  1. review logs to decide whether this was timeout/failure or manual cancellation;
  2. manually re-run required CI or push a new commit;
  3. decide whether an intentional non-blocking cancellation can be merged outside automation.
- Keeps the existing behavior when a cancelled/stale workflow is successfully re-triggered: do not restart AI, wait for the new CI status.

## Regression Test

`tests/test-cancelled-ci-rerun-1769.mjs` covers:

- the auto-merge source now has a terminal `ci_cancelled_requires_review` path;
- the watcher posts a cancelled-CI review comment before exiting;
- only `cancelled` and `stale` workflow runs are re-trigger candidates;
- a `403` re-run failure requires human review;
- the PR comment includes manual re-run guidance and timeout-as-CI-failure guidance.
