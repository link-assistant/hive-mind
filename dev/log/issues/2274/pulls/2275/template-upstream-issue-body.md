## Problem

`scripts/land-via-pull-request.mjs` cannot land an automated release pull request when the protected base branch requires the template's `Pipeline Status` check.

The helper creates the pull request with `GITHUB_TOKEN` and immediately retries `gh pr merge`. GitHub does not ordinarily create workflow runs for events caused by `GITHUB_TOKEN`; for `pull_request` opened/synchronize/reopened, the runs instead remain `action_required` pending approval. Consequently `Pipeline Status` is never reported for the release head and every merge retry fails permanently.

This is the status-check extension of #143: the pull-request fallback satisfies “require a pull request,” but it does not satisfy a newly required CI check.

The same implementation is used by `link-assistant/hive-mind`. After `Pipeline Status` became required there on 2026-09-20, four consecutive releases failed:

- [run 35492495204](https://github.com/link-assistant/hive-mind/actions/runs/35492495204) created [PR 2268](https://github.com/link-assistant/hive-mind/pull/2268)
- [run 35495996039](https://github.com/link-assistant/hive-mind/actions/runs/35495996039) created [PR 2272](https://github.com/link-assistant/hive-mind/pull/2272)
- [run 35519980846](https://github.com/link-assistant/hive-mind/actions/runs/35519980846) created [PR 2273](https://github.com/link-assistant/hive-mind/pull/2273)
- [run 35526569064](https://github.com/link-assistant/hive-mind/actions/runs/35526569064) created [PR 2276](https://github.com/link-assistant/hive-mind/pull/2276)

All twelve PR-triggered workflows across those PRs concluded `action_required`; none produced the required check.

## Minimal reproduction

1. Configure a default-branch ruleset with:
   - require a pull request;
   - require the `Pipeline Status` check;
   - strict/up-to-date checks;
   - no bypass actor for the workflow token.
2. Run the release workflow with a changeset so the direct push is rejected and `landViaPullRequest` creates a release PR.
3. Observe that the PR's workflows are `action_required` and `Pipeline Status` is expected.
4. Observe all ten `gh pr merge --merge` attempts fail with `the base branch policy prohibits the merge`.

Expected: the fallback validates the generated head and merges it after the required check succeeds.

Actual: the release job retries an invariant policy failure for about 50 seconds and exits 1.

## Workarounds

- Manually approve the action-required run on every generated release PR, then merge it. This breaks unattended releases.
- Give an actor bypass permission or remove the required check. Both weaken the protected-branch policy and are not recommended.
- Dispatch validation explicitly with a PAT/GitHub App token. This works but adds a secret that is unnecessary because `GITHUB_TOKEN` can dispatch with `actions: write`.

## Suggested code fix

Use GitHub's documented exception for token-triggered events:

1. Add an internal `workflow_dispatch` mode such as `validate-pr` to `release.yml`.
2. After PR creation and before `mergePullRequestWithRetry`, run:

   ```sh
   gh workflow run release.yml \
     --ref "$release_branch" \
     --raw-field release_mode=validate-pr \
     --raw-field bump_type=patch
   gh run watch "$run_id" --exit-status --compact
   ```

3. Grant only the release job `actions: write` (and `checks: read` for the watcher) in addition to its existing permissions.
4. Ensure `validate-pr` cannot enter any publishing/manual-release job; it should run the ordinary checks and terminal `Pipeline Status` gate only.
5. Attempt the merge only after the dispatched run succeeds. Propagate a failed validation immediately instead of retrying the merge.
6. Add a regression test whose merge mock succeeds only after dispatch/watch completes.

GitHub documents that `workflow_dispatch` and `repository_dispatch` are the exceptions that do create runs when initiated with `GITHUB_TOKEN`: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows

`gh workflow run` returns the created run URL when available, which supplies the run ID for `gh run watch`: https://cli.github.com/manual/gh_workflow_run

An alternative for high-volume repositories is GitHub's merge queue, but it requires adding the `merge_group` trigger and still needs compatible required-check reporting: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
