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
- npm registry metadata in `npm-command-stream-0.25.0.json` records that
  command-stream `0.25.0` was published at 2026-09-21T08:19:52.469Z, after the
  prior green run's detector queried the registry and before the failing
  auto-restart run began.
- The upstream primary-source compare and commit payloads are retained as
  `github-command-stream-0.24.1-to-0.25.0-compare.json` and
  `github-command-stream-cancellable-child-handles.json`. They show that the
  JavaScript release adds cancellable child-process handles while preserving
  the existing execution API. GitHub had no release or tag object for 0.25.0
  at investigation time; the two captured 404 responses document that npm and
  commit history were the available authoritative sources.
- npm metadata in `npm-use-m-8.16.1.json` timestamps use-m `8.16.1` at
  2026-09-21T08:55:10.606Z, after the first corrected freshness run and while
  the complete local suite was running. The authoritative upstream comparison
  `github-use-m-8.16.0-to-8.16.1-compare.json.gz` shows the patch adds resilient
  latest-version resolution across malformed registry responses, transient
  network failures, and package-manager fallbacks. GitHub had no release or
  tag object for 8.16.1 at investigation time; the captured 404 payloads retain
  that negative evidence.

## GitHub-hosted runner image migration

- GitHub's official
  [`ubuntu-latest` Ubuntu 26 migration announcement](https://github.com/actions/runner-images/issues/14748)
  schedules rollout from 2026-10-19 through 2026-11-19, identifies software and
  system-level differences, and explicitly recommends `ubuntu-24.04` when a
  workflow must remain on the current image.
- The official
  [runner selection documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)
  lists `ubuntu-24.04` as a supported standard hosted-runner label.
- The official
  [runner-images repository](https://github.com/actions/runner-images#latest-migration-process)
  explains that `-latest` migrations are gradual and that explicit version
  labels prevent an unwanted operating-system migration.
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
