Correction to the suggested fix above: an explicit `workflow_dispatch` run can execute and pass, but GitHub does **not** evaluate its workflow-job checks as pull-request required checks. GitHub now documents this exact counterexample: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#checks-from-some-workflow-jobs-are-not-evaluated

We reproduced that distinction twice in production after the first attempted fix:

- hive-mind [run 35530498148](https://github.com/link-assistant/hive-mind/actions/runs/35530498148) opened [PR #2277](https://github.com/link-assistant/hive-mind/pull/2277). Its explicit [validation run 35530983182](https://github.com/link-assistant/hive-mind/actions/runs/35530983182) passed, but the PR check rollup remained empty and all merge attempts failed with `the base branch policy prohibits the merge`.
- [run 35536130313](https://github.com/link-assistant/hive-mind/actions/runs/35536130313) repeated the result with [PR #2278](https://github.com/link-assistant/hive-mind/pull/2278) and successful [validation run 35536619299](https://github.com/link-assistant/hive-mind/actions/runs/35536619299).

In both cases the real `pull_request` runs for Checks and release, Security, and Broken Link Checker concluded `action_required`; the successful `workflow_dispatch` run used the same head SHA but was not associated with the PR for ruleset evaluation.

Minimal reproduction:

1. Require a GitHub Actions check such as `Pipeline Status` on the base branch, with no bypass actor.
2. Create a PR from a workflow using its built-in `GITHUB_TOKEN`.
3. Observe the `pull_request` run awaiting approval.
4. Dispatch the same workflow manually against the exact PR head and let its identically named check pass.
5. Observe that `gh pr view --json statusCheckRollup` still lacks that check and `gh pr merge --merge` remains policy-blocked.

Workarounds:

- A maintainer can approve the `action_required` runs manually, but this breaks unattended releases.
- Removing the required check or adding a bypass actor weakens the policy and is not recommended.
- The reliable automated workaround is to create/update the PR with a dedicated least-privilege PAT or, preferably, a short-lived custom GitHub App installation token. GitHub recommends those credentials for automatically running workflows from workflow-created PRs: https://docs.github.com/en/enterprise-cloud@latest/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs

Suggested template fix:

1. Accept a dedicated release-PR token (or generate one with `actions/create-github-app-token`) and fail before pushing a release branch when it is missing.
2. Use that credential when creating or updating the fallback PR so ordinary `pull_request` checks run without approval.
3. Wait on the PR itself with `gh pr checks "$url" --watch --fail-fast`, then merge.
4. Retry only the short check-discovery/mergeability races; fail immediately on a real failed check or repository-policy error.
5. Do not add a `workflow_dispatch` validation mode or `actions: write` solely for this path.
6. Cover ordering, failed-check propagation, missing-token fail-closed behavior, and permanent-policy error classification in regression tests.

`actions/create-github-app-token` is GitHub-owned and supports explicitly scoped installation permissions: https://github.com/actions/create-github-app-token
