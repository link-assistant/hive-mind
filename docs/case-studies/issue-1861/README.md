# Issue 1861 Case Study: CodeRabbit Credit Limit Auto-Restart Loop

## Incident

Issue: https://github.com/link-assistant/hive-mind/issues/1861

The referenced run monitored ProverCoderAI/docker-git PR #387 with `--auto-restart-until-mergeable`. CodeRabbit posted a rate/usage-credit warning at 2026-06-08T07:55:50Z, but the watcher kept treating the resulting failed external status as an actionable CI failure. It retried the same check every 120 seconds until the user interrupted the session at 2026-06-08T09:21:32Z.

## Evidence

- `solution-draft-log-pr-1780910494946.txt`: 31,638-line solver log downloaded from the Gist linked in the issue.
- `docker-git-pr-387-coderabbit-comment-4646545475.json`: CodeRabbit comment saying the review limit was reached and the organization had run out of usage credits.
- `docker-git-pr-387-comment-4646622947.json`: Solution draft log upload comment.
- `docker-git-pr-387-comment-4647221343.json`: failure comment after manual CTRL+C interruption.
- `docker-git-pr-388-comment-4647159343.json`: related auto-restart triggered by real CI failures.
- `docker-git-pr-388-comment-4647539242.json`: related investigation showing GitHub Actions green while CodeRabbit remained blocked by insufficient review credits.

## Root Cause

`getDetailedCIStatus()` collected external commit statuses but did not preserve status descriptions. `getMergeBlockers()` then classified every completed failure that was not a GitHub Actions billing or cancelled/stale case as `ci_failure`. A CodeRabbit status such as `CodeRabbit: Insufficient review credits` therefore reached `watchUntilMergeable()` as real CI feedback, which triggered the auto-restart path instead of stopping for human review.

The issue also required preserving the opposite behavior: real GitHub Actions failures, including Check/E2E/final build failures, must still trigger auto-restart.

## Fix

- Preserve check/status descriptions in detailed CI data and treat commit-status `error` as a failure.
- Split failed checks into non-actionable external review quota failures and actionable CI failures.
- Add an `external_review_limit` blocker for CodeRabbit credit/rate-limit failures.
- Stop the watcher with a `Ready for review` PR comment when the only remaining failure is the external review quota blocker.
- Include a `Checks not executed` section with the blocked external review check and reason.
- Keep mixed failures actionable by still emitting `ci_failure` blockers for real CI failures.
- Register `Ready for review` as a tool-generated comment marker so it does not become fresh feedback on the next monitoring pass.

## Regression Coverage

`tests/test-issue-1861-coderabbit-review-limit.mjs` covers:

- CodeRabbit `Insufficient review credits` classification.
- CodeRabbit review-limit/usage-credit wording from the incident comment.
- Normal GitHub Actions failures remaining actionable.
- Quota-only failures not producing actionable CI failures.
- Mixed CodeRabbit quota plus real CI failure still triggering auto-restart for the real failure.
- `Ready for review` comments listing checks not executed and avoiding `Ready to merge` wording.
