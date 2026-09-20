# Issue 1612 Case Study: PRs Stuck While GitHub UI Shows Checks Passed

## Summary

Issue [#1612](https://github.com/link-assistant/hive-mind/issues/1612) reports pull requests that remain in the "CI mechanisms DISAGREE" loop even though GitHub shows all checks for the PR as passed.

The downloaded logs confirm the pattern:

- The PR's check-runs API reports `success`
- The PR head SHA has all workflow runs `completed`
- All commits on the PR have completed CI
- Unrelated workflow runs on other branches remain active
- The repo-wide actions mechanism forces consensus to `DISAGREE`

Root cause: repo-wide action gating was treated as part of the mergeability consensus in some real executions, while the feature is too strict for the default PR-ready path because it blocks on unrelated branches. The repository also had a documentation/config mismatch around this option's default.

## Requirements Reconstructed From The Issue

1. Do not keep PRs blocked when PR-scoped CI is complete and GitHub UI already shows success.
2. Preserve a stricter mode for repositories where cross-branch workflows truly must block mergeability.
3. Collect local evidence for the incident in `docs/case-studies/issue-1612`.
4. Reconstruct timeline, requirements, root causes, and solution options.
5. Add enough diagnostics so the next occurrence is easier to explain if a stronger root cause appears.

## Root Causes

1. The repo-wide actions mechanism is intentionally absolute: any active run on any branch marks `RepoActions=false`.
2. The consensus check is unanimous, so a single `RepoActions=false` result keeps the PR in a waiting loop even when PR-specific CI is fully complete.
3. The option `--wait-for-all-actions-in-repository-before-mergeable` was documented/configured as default `true`, but runtime behavior was also normalized separately. That mismatch made the intended behavior unclear and likely contributed to the issue report.
4. The current logs do not show a failure in GitHub's PR checks APIs. They show a product decision mismatch: repo-global safety was being applied to a PR-scoped readiness decision.

## Timeline

- 2026-04-15: Issue opened with screenshot and sample logs.
- 2026-04-15 17:03:31 UTC: Example PR `#1834` reaches detailed CI status `success` and 8 workflow runs are found for the PR SHA.
- 2026-04-15 17:03:50 UTC: Same log shows `repo-actions: 9 active run(s)` on other branches and consensus flips to `DISAGREE`.
- 2026-04-15 17:16:33 UTC: Example PR `#1837` reaches detailed CI status `success`.
- 2026-04-15 17:16:52 UTC through 17:57:04 UTC: Repeated checks show all PR-specific mechanisms complete while unrelated active runs keep `RepoActions=false`.

## Solution Options Considered

1. Default to PR-scoped CI only, keep repo-wide gating as an explicit strict flag.
2. Add a majority-vote consensus model.
3. Add a browser-based GitHub UI scrape as another signal.
4. Filter repo-wide runs to only "related" branches or workflows.

## Chosen Fix

Option 1.

Why:

- It matches the issue evidence directly.
- It preserves the strongest safety mode for users who need it.
- It avoids adding flaky heuristics about which unrelated workflows matter.
- It stays compatible with the existing explicit strict option.

## Evidence Index

- [Issue JSON](./evidence/issue-1612.json)
- [PR JSON](./evidence/pr-1613.json)
- [Key log lines](./evidence/log-key-lines.txt)
- [Issue screenshot](./images/issue-1612-screenshot.png)
- External logs:
  - [solve-2026-04-15T16-54-37-686Z.log](./external/solve-2026-04-15T16-54-37-686Z.log)
  - [solve-2026-04-15T17-08-54-854Z.log](./external/solve-2026-04-15T17-08-54-854Z.log)
  - [solve-2026-04-15T17-09-45-312Z.log](./external/solve-2026-04-15T17-09-45-312Z.log)
  - [solve-2026-04-15T17-22-47-385Z.log](./external/solve-2026-04-15T17-22-47-385Z.log)

## External Facts Used

- GitHub check-runs and workflow-runs are separate mechanisms and can disagree transiently.
- GitHub Actions workflow runs are repository-wide resources, not PR-scoped by default.
- A repository-global active-run check is stricter than PR readiness and should therefore be opt-in.

## Follow-Up Ideas

1. If users still want extra confidence, add a separate informational section that reports repo-wide active runs without blocking mergeability.
2. If a future repo truly has cross-branch coupling, document `--wait-for-all-actions-in-repository-before-mergeable` in its project-specific workflow guide.
3. If this recurs in a way not explained by repo-wide runs, add persisted debug snapshots of `check-runs`, `workflow-runs`, and `repo-actions` API responses for each mergeability poll.
