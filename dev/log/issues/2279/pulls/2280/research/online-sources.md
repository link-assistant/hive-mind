# Online research for issue #2279

Research refreshed on 2026-09-21. Primary documentation was preferred for
GitHub and GitHub CLI behavior.

## Required-check eligibility

- GitHub, "Troubleshooting required status checks":
  https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks
  - Workflow-job checks count for pull-request required checks only when the
    run was triggered by `push`, `pull_request`, `pull_request_review`,
    `pull_request_target`, `deployment`, or `deployment_status`.
  - GitHub explicitly uses a `workflow_dispatch` run on a PR head as the
    counterexample: those checks do not appear in the PR checks section and do
    not satisfy a required ruleset check, even when the run passes.
  - A strict check policy additionally requires the PR to be current with its
    base branch.

## Automation-token behavior

- GitHub, "GITHUB_TOKEN":
  https://docs.github.com/en/enterprise-cloud@latest/actions/concepts/security/github_token
- GitHub, "Triggering a workflow":
  https://docs.github.com/en/enterprise-cloud@latest/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
  - `pull_request` opened/synchronize/reopened events caused by the built-in
    token create runs in an approval-required state.
  - GitHub recommends a custom GitHub App installation token or personal
    access token when workflow-created PRs must run automatically.
  - `workflow_dispatch` is an exception that the built-in token can trigger,
    but that exception only creates a run; it does not change the separate
    required-check eligibility rule above.

## Existing components

- GitHub CLI, `gh pr checks`:
  https://cli.github.com/manual/gh_pr_checks
  - `--watch` polls until checks finish, `--fail-fast` stops on a failed check,
    and `--interval` controls polling. This is already installed in the release
    runner, so no new runtime dependency is needed.
- GitHub, `actions/create-github-app-token`:
  https://github.com/actions/create-github-app-token
  - Official GitHub-owned action for producing a short-lived installation
    token with explicit permissions. It is the preferred future replacement
    for a long-lived PAT once an App is provisioned.
- GitHub, "Making authenticated API requests with a GitHub App in a GitHub
  Actions workflow":
  https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow
  - Documents registering/installing the App, storing its client ID/private
    key, and using `actions/create-github-app-token`.
- `peter-evans/create-pull-request` concepts:
  https://github.com/peter-evans/create-pull-request/blob/main/docs/concepts-guidelines.md
  - The established action documents the same limitation and recommends a
    dedicated machine-user PAT or GitHub App token to make downstream PR
    workflows run. Adopting the action would duplicate this repository's
    existing branch naming, ruleset handling, version commit, and merge logic,
    so the smaller fix is to retain the local helper and supply the correct
    credential.

## Dependency freshness

- npm registry metadata captured in `npm-yargs-18.2.0.json` confirms that the
  exact declaration `yargs 18.1.0` was stale when the prepared PR first ran.
  The repository's own freshness checker is the authoritative reproduction.

## Template comparison

- Compared repository:
  https://github.com/link-foundation/js-ai-driven-development-pipeline-template
- Local research checkout: commit `e4f23d74` (recorded in
  `template-commit.txt`).
- Full `.github` and `scripts` trees, SHA-256 inventories, repository-only and
  template-only file lists, and unified diffs are stored beside this file.
- The template has the same `GITHUB_TOKEN` release-PR deadlock and does not
  contain this repository's invalid explicit-dispatch workaround. Existing
  upstream issue #192 covers it; a correction comment supersedes that issue's
  now-known-invalid `workflow_dispatch` recommendation.
