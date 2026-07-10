# Development Log: Issue 1596 / PR 1996

## Scope

Issue: <https://github.com/link-assistant/hive-mind/issues/1596>
PR: <https://github.com/link-assistant/hive-mind/pull/1996>
Branch: `issue-1596-17953fa6e3af`

The requested feature is a `--development-log` option that gives the agent one issue-type-specific data-collection sentence while the solve algorithm independently preserves resumable native tool sessions under per-UUID repository paths.

## Collected Artifacts

- `issue-1596.txt`: issue body and comments fetched with `gh issue view --comments`.
- `issue-comments.json`: paginated issue comments from the GitHub API.
- `pr-1996.json`: PR metadata, commits, reviews, comments, and status summary from `gh pr view`.
- `pr-comments.json`: PR conversation comments from the issue comments endpoint.
- `pr-review-comments.json`: inline PR review comments.
- `pr-reviews.json`: PR review records.
- `commands/npm-ci-1596.log`: dependency installation output for local verification.
- `commands/npm-test-1596.log`: full `npm test` output for local verification.

No failing CI run was reported during implementation, so no workflow logs were downloaded for this run.

## Local Verification Notes

- Dependencies were installed with `npm ci`; the install succeeded but warned that the local container uses Node 20 while this package declares Node 24+.
- The focused reproducer and validation test is `tests/test-development-log-option-1596.mjs`.
- The option is implemented as a solve option and is auto-forwarded by hive through the existing solve passthrough mechanism.

## Implementation Summary

- Added `src/development-log.lib.mjs` for shared path generation, the single-line prompt, per-session artifact writing, and path-scoped git commit/push handling.
- Added `--development-log` to `SOLVE_OPTION_DEFINITIONS`.
- Added automatic GitHub issue-type detection (`fetchIssueType`) so the injected prompt uses the bug "download all logs" wording for `Bug` issues and the universal data-collection wording for feature/task or unspecified issues.
- Added Codex rollout transcript discovery (`~/.codex/sessions/.../rollout-*-<sessionId>.jsonl`) alongside Claude transcript copying, with each session stored under `sessions/{UUID}` by solve rather than delegated to the agent.
- Added the shared collection sentence to the regular user/start prompt for Claude, Codex, Gemini, OpenCode, Qwen, and Agent while keeping it out of their system prompts.
- Hooked solve finalization to write and commit artifacts after final cleanup.
- Updated `docs/CONFIGURATION.md` and added a changeset.
