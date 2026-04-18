# Issue 1642 Case Study: Quiet Claude Code Solve Runs

## Summary

Issue #1642 requests deterministic, quiet Claude Code execution for the `solve` command and Docker images. The root cause was local to hive-mind: Claude subprocesses inherited host Claude Code configuration, `solve` did not merge the required quiet settings into `~/.claude/settings.json`, and Docker images only pre-seeded `disallowedTools` from issue #1627.

## Collected Data

- `data/issue-1642.json`: issue title, body, timestamps, and metadata.
- `data/issue-1642-comments.json`: issue discussion, including the case-study requirement.
- `data/pr-1643.json`: prepared pull request metadata.
- `data/pr-1643-review-comments.json` and `data/pr-1643-reviews.json`: PR review data; both were empty at investigation time.
- `external/*.html`: downloaded official Claude Code documentation pages for configuration, environment variables, memory, interactive mode, and data usage.

## Timeline

- 2026-04-18 15:07 UTC: Issue #1642 opened with the requirement to disable noisy Claude Code features in `solve` and the Docker image.
- 2026-04-18 15:09 UTC: PR #1643 created as a draft for branch `issue-1642-51e94ad4ccf4`.
- 2026-04-18 15:09 UTC: Issue comment requested all related issue/PR data and external research be saved under `docs/case-studies/issue-1642`.
- 2026-04-18 investigation: repo search found no existing runtime enforcement for the six requested quiet env vars, and Dockerfiles only configured useless tool blocks.

## Requirements

- `solve` must read the global Claude settings file at `~/.claude/settings.json`, creating an empty object only if the file is absent.
- `solve` must override only these settings keys, preserving everything else:
  `autoMemoryEnabled=false`, `spinnerTipsEnabled=false`, `awaySummaryEnabled=false`, `feedbackSurveyRate=0`,
  `includeCoAuthoredBy=false`, `prefersReducedMotion=true`, `showThinkingSummaries=false`,
  and `viewMode="verbose"`.
- `solve` must also merge `attribution.commit=""` and `attribution.pr=""` to hide Claude attribution on commits and PRs (preserving any other unrelated attribution subkeys).
- `solve` must merge the required env vars into the settings `env` object without dropping unrelated env entries.
- `solve` must export the required env vars to the Claude subprocess environment:
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_CRON=1`, `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1`,
  `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1`,
  `CLAUDE_CODE_DISABLE_FAST_MODE=1`, `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1`, `CLAUDE_CODE_DISABLE_MOUSE=1`,
  `CLAUDE_CODE_ENABLE_AWAY_SUMMARY=0`, `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=4`, and `DISABLE_FEEDBACK_COMMAND=1`.
- Docker images must set the same env vars and ship a baseline `~/.claude/settings.json` containing the target settings, attribution overrides, and the env block.
- Startup logs must make the effective quiet configuration auditable without logging unrelated user settings or secrets.
- Existing unrelated user settings must be preserved.

## External Research

- Claude Code settings documentation says user settings live in `~/.claude/settings.json`, and settings support an `env` object for environment variables that apply to every session: https://code.claude.com/docs/en/configuration
- Claude Code environment variable documentation confirms `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS`, `CLAUDE_CODE_DISABLE_CRON`, `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS`, `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`, and `DISABLE_FEEDBACK_COMMAND`: https://code.claude.com/docs/en/env-vars
- Claude Code memory documentation confirms `autoMemoryEnabled=false` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` disable auto memory: https://code.claude.com/docs/en/memory
- Claude Code interactive mode documentation confirms session recap can be disabled by configuration: https://code.claude.com/docs/en/interactive-mode
- Claude Code data usage documentation confirms session quality surveys can be suppressed through settings such as `feedbackSurveyRate=0`: https://code.claude.com/docs/en/data-usage

## Root Causes

- `src/config.lib.mjs#getClaudeEnv()` exported Claude-specific limits and timeouts, but not the six quiet env vars required by the issue.
- `src/claude.lib.mjs#executeClaudeCommand()` invoked Claude without verifying or merging global user settings first.
- `src/useless-tools.lib.mjs` already had a settings merge pattern for `disallowedTools`, but that helper was scoped to issue #1627 and did not cover noisy Claude Code features.
- `Dockerfile` and `coolify/Dockerfile` pre-seeded only useless tool configuration, leaving auto memory, spinner tips, away summaries, feedback surveys, terminal-title changes, CLAUDE.md loading, cron, and built-in git instructions governed by the host/default Claude Code config.

## Solution Plan

- Add a focused `src/claude-quiet-config.lib.mjs` module with the required env vars, required settings keys, a subprocess env builder, and a safe merge helper for `~/.claude/settings.json`.
- Update `getClaudeEnv()` to overlay the six required env vars after `process.env` so host values cannot re-enable those features for the Claude subprocess.
- Call the settings merge helper from `executeClaudeCommand()` before constructing and launching the Claude command.
- Extend both Dockerfiles with `ENV` directives and baseline settings merge logic for the same quiet config.
- Add a regression test that verifies subprocess env, settings merge preservation, Dockerfile defaults, and runtime wiring.

## Reproduction And Verification

Before the fix, `node tests/test-claude-quiet-config.mjs` failed with:

```text
AssertionError [ERR_ASSERTION]: getClaudeEnv should force CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
undefined !== '1'
```

After the fix, the focused test passes and confirms unrelated settings are preserved.

## Upstream Reporting

No upstream Claude Code issue was filed. The external behavior needed here is documented; the defect was hive-mind not applying the documented configuration consistently in `solve` and its Docker images.
