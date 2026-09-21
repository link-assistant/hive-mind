## Problem

The protected-release fix from #192 / #195 makes `RELEASE_PR_TOKEN` mandatory. That leaves installations without a separately provisioned PAT or custom GitHub App unable to release, even though the parent release run has already completed every validation job and its built-in `GITHUB_TOKEN` is a short-lived installation token for the GitHub Actions App.

This happened in `link-assistant/hive-mind` immediately after porting the template change:

- [hive-mind issue 2281](https://github.com/link-assistant/hive-mind/issues/2281)
- [failing release run 35587213311](https://github.com/link-assistant/hive-mind/actions/runs/35587213311)
- [candidate fix PR 2282](https://github.com/link-assistant/hive-mind/pull/2282)

All pre-release jobs passed. The Main ruleset correctly rejected the direct push with GH013, then `version-and-commit.mjs` aborted because `RELEASE_PR_TOKEN` was empty. The repository maintainer does not want to provision or rotate a long-lived release PAT.

## Minimal reproduction

1. Apply a default-branch ruleset that requires both a pull request and the GitHub Actions `Pipeline Status` check, with no bypass actor.
2. Configure the Changesets release workflow, but do not define `RELEASE_PR_TOKEN`.
3. Merge a normal PR containing a changeset.
4. Let the parent push workflow pass its lint, test, and release-preflight jobs.
5. Observe the generated version commit fail its direct push with GH013.
6. Observe the fallback stop before creating the release PR because the dedicated token is missing.

This differs from the invalid `workflow_dispatch` workaround documented in #192: the parent workflow does not claim that an unrelated dispatch run satisfies the PR rule. It attests only to a tightly constrained metadata transformation performed after the parent validation.

## Suggested alternative

Support a built-in-token mode in addition to the existing dedicated-token mode:

1. Make the release and instant-release jobs depend explicitly on every pre-release validation job and require their success.
2. After Changesets creates the version commit, inspect that commit with `git diff-tree` and fail unless every path is release metadata (for example `package.json`, `package-lock.json`, `CHANGELOG.md`, and consumed `.changeset/*.md` files). This proves the executable/source tree is identical to the parent SHA that passed validation.
3. Give only those release jobs `checks: write`; keep all other token permissions unchanged.
4. Use the built-in `GITHUB_TOKEN` to open the fallback PR.
5. Use the Checks API to create a completed successful `Pipeline Status` check on the exact generated commit SHA, with the parent run URL and a summary that explains the metadata-only invariant.
6. Wait with `gh pr checks --required --watch --fail-fast` and merge only after GitHub recognizes the required result.
7. Fail closed on an unexpected changed path, Checks API denial, required-check failure, or merge-policy error.

The current hive-mind implementation and regression tests are in PR 2282. In particular, the tests require check creation before required-check watching, required-check success before merge, and no merge after API/check failure.

GitHub documents that `GITHUB_TOKEN` is an installation token for the repository's GitHub Actions App and that an installation token with `checks: write` can create check runs:

- https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication
- https://docs.github.com/en/rest/checks/runs#create-a-check-run

## Workarounds

- Configure the existing `RELEASE_PR_TOKEN` as a fine-grained PAT. This works but adds long-lived credential scope, rotation, and maintainer burden.
- Generate a short-lived custom GitHub App token. This avoids a PAT but still requires installing and configuring another identity and private key.
- Manually approve the `action_required` pull-request runs. This preserves validation but makes releases attended.
- Remove the required check or grant bypass. This weakens branch protection and is not recommended.

## Compatibility suggestion

Keep the dedicated-token flow as the preferred path when configured, and add the parent-run attestation flow as an explicit opt-in or documented alternative for repositories that reject additional release credentials. The metadata allowlist should be configurable because workspaces may version multiple manifests or generated lockfiles.
