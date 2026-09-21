# Online and upstream research

Research was performed on 2026-09-21 UTC. Saved files in this directory preserve the retrieved content or API/search response.

## Primary sources

- [GitHub: Triggering a workflow](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow): events created by `GITHUB_TOKEN` do not ordinarily create recursive workflow runs; current documentation says bot-created pull requests create approval-required runs rather than unattended runs.
- [GitHub changelog, 2026-06-11: bot-created pull requests can run workflows if approved](https://github.blog/changelog/2026-06-11-bot-created-pull-requests-can-run-workflows-if-approved/): confirms the approval gate is intentional current behavior, not a transient outage.
- [GitHub REST API: Create a check run](https://docs.github.com/en/rest/checks/runs#create-a-check-run): GitHub App installation access tokens with `checks: write` may create check runs for a commit.
- [GitHub: Automatic token authentication](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication): `GITHUB_TOKEN` is an installation access token for the repository's GitHub Actions app, and job permissions should be scoped explicitly.
- [GitHub: Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks): required checks are evaluated for the pull-request head and expected app/source.
- [GitHub: Rules available for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets): pull-request and required-check rules explain the two GH013 messages in the production run.
- [Changesets action](https://github.com/changesets/action): supplies a standard version-PR implementation and supports custom tokens, but it cannot make a built-in-token PR run unattended through this ruleset.
- [Changesets issue 70](https://github.com/changesets/action/issues/70): historical discussion of `GITHUB_TOKEN` not triggering downstream workflows; it reinforces that replacing the local helper with the action would not remove the recursion/approval constraint.

## Related template

- [Template issue 192](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/192) and [PR 195](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/pull/195) address the same required-check deadlock by mandating an independent PAT/App token.
- That solution is incompatible with the explicit issue requirement that no `RELEASE_PULL_REQUEST_TOKEN` will be provisioned.
- [Template issue 196](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/196) is the resulting follow-up report. It provides the metadata-only check-attestation design as a short-lived-token alternative; the submitted body and API response are retained as `upstream-follow-up-*`.

## Components considered

| Component | Useful capability | Decision |
| --- | --- | --- |
| GitHub Checks REST API / `gh api` | Publish a named result on the exact version SHA using the Actions App installation token | Selected; no dependency and matches the ruleset's required app |
| `gh pr checks --required` | Discover and watch only ruleset-required checks | Selected; prevents merging before GitHub observes the attestation |
| Changesets CLI | Deterministic version, changelog, lockfile, and changeset consumption | Retained; the resulting commit is restricted to those metadata paths |
| `changesets/action` | Standard version PR and publish orchestration | Not substituted; the repository has product-specific publish/Docker/Helm recovery and the token-trigger constraint remains |
| `peter-evans/create-pull-request` | General PR creation | Already used for manual changeset PRs; does not solve the unattended built-in-token required-check problem |
| Fine-grained PAT | Independent actor can trigger ordinary PR CI | Rejected by explicit maintainer requirement and long-lived-secret cost |
| Custom GitHub App token | Short-lived independent credential and ordinary PR CI | Viable alternative if installed later, but no installation exists and none is required by this fix |
| Ruleset bypass | Direct merge/push exception | Rejected: weakens the invariant, and GitHub returned HTTP 422 when the repository tried to name GitHub Actions as a bypass actor |
