# Online Research Sources

Accessed on 2026-04-17.

These sources were used to validate the GitHub collection methods for this case
study and to check the relevant API/library surface area.

## GitHub Data Collection

- GitHub CLI `gh run view` manual:
  <https://cli.github.com/manual/gh_run_view>

  The manual documents `--log` for viewing the full log for a workflow run or
  job, plus JSON fields such as `databaseId`, `conclusion`, `createdAt`,
  `headSha`, `status`, `url`, and `workflowName`.

- GitHub REST API, workflow runs:
  <https://docs.github.com/en/rest/actions/workflow-runs>

  The workflow-runs API documents listing workflow runs and filtering by branch,
  status, and head SHA. It also documents downloading workflow run logs through
  the run logs endpoint.

- GitHub REST API, timeline events:
  <https://docs.github.com/en/rest/issues/timeline>

  The issue timeline endpoint documents listing timeline events for issues and
  pull requests. It is useful for reconstructing referenced, committed, closed,
  and reopened events.

- GitHub REST API, issue comments:
  <https://docs.github.com/en/rest/issues/comments>

  GitHub documents that pull requests are issues for comment purposes. This is
  why PR conversation comments are collected through the issue-comments API.

- GitHub REST API, pull request review comments:
  <https://docs.github.com/en/rest/pulls/comments>

  Review comments are distinct from conversation comments and need the pull
  request review-comments endpoint.

## Existing Hive Mind Components

Local code search focused on these components:

- `src/agent.lib.mjs`
- `src/agent-token-usage.lib.mjs`
- `src/solve.restart-shared.lib.mjs`
- `src/solve.auto-merge.lib.mjs`
- `tests/test-agent-error-detection.mjs`

The local search output is preserved in:

- `research/hive-code-local-search.txt`
- `research/hive-code-search-auto-restart.txt`
- `research/hive-merged-pr-search.txt`
